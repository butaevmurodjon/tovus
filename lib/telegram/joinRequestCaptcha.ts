import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import { getRedis } from "@/lib/db/redis";
import { t, type Lang } from "@/lib/i18n";
import { mentionHtml } from "./format";

/**
 * Opt-in captcha for groups that require admin approval to join
 * ("chat_join_request" mode). Deliberately separate from lib/telegram/captcha.ts:
 * that one mutes an already-admitted member and verifies them in-group; this
 * one runs BEFORE admission, in the requester's private chat, and resolves by
 * approving/declining the join request rather than restoring send permissions.
 * Small duplication (the math-question generator) is intentional — force-fitting
 * this into the group-mute state machine would tangle two genuinely different
 * lifecycles together.
 *
 * Delivery relies on Telegram's stable exception that lets a bot message a user
 * who just submitted a join request to a chat the bot administers, even if that
 * user never started the bot — no deep link needed, unlike the appeal/
 * message-captcha flows which have no such exception and must bounce through
 * /start.
 */

const stateKey = (chatId: number, userId: number) => `joinreqcaptcha:${chatId}:${userId}`;
const pendingSetKey = (chatId: number) => `joinreqcaptcha:pending:${chatId}`;

interface JoinRequestCaptchaState {
  token: string;
  promptChatId: number;
  promptMessageId: number;
  correctAnswer: number;
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Same shape as captcha.ts's randomMathQuestion — duplicated rather than
 * imported, see file doc comment. Exported for tests only. */
export function randomMathQuestion(): { a: number; b: number; correct: number; options: number[] } {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const correct = a + b;
  const wrong = new Set<number>();
  while (wrong.size < 3) {
    const delta = 1 + Math.floor(Math.random() * 5);
    const candidate = Math.random() < 0.5 ? correct - delta : correct + delta;
    if (candidate >= 0 && candidate !== correct) wrong.add(candidate);
  }
  return { a, b, correct, options: shuffle([correct, ...wrong]) };
}

export type StartResult = "sent" | "blocked";

/**
 * Sends the requester a math-captcha DM. Returns "blocked" (never throws) when
 * the DM can't be delivered (bot blocked, privacy settings, etc.) — callers
 * must treat that exactly like today's "can't act, leave the request pending"
 * default, NOT as a reason to decline; declining because delivery failed would
 * make the opt-in strictly worse than having it off.
 */
export async function startJoinRequestCaptcha(
  api: Api,
  chatId: number,
  chatTitle: string,
  user: User,
  lang: Lang,
  timeoutSeconds: number
): Promise<StartResult> {
  const token = randomToken();
  const { a, b, correct, options } = randomMathQuestion();

  const text = t(lang, "bot.joinRequestCaptchaDm", {
    user: mentionHtml(user),
    title: chatTitle,
    seconds: timeoutSeconds,
    a,
    b,
  });

  let sent;
  try {
    sent = await api.sendMessage(user.id, text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          options.slice(0, 2).map((value) => ({
            text: String(value),
            callback_data: `jrc:${chatId}:${user.id}:${token}:${value}`,
          })),
          options.slice(2).map((value) => ({
            text: String(value),
            callback_data: `jrc:${chatId}:${user.id}:${token}:${value}`,
          })),
        ],
      },
    });
  } catch (err) {
    if (err instanceof GrammyError) return "blocked";
    throw err;
  }

  const redis = getRedis();
  const state: JoinRequestCaptchaState = {
    token,
    promptChatId: user.id,
    promptMessageId: sent.message_id,
    correctAnswer: correct,
  };
  await redis.set(stateKey(chatId, user.id), state, { ex: timeoutSeconds });
  await redis.sadd(pendingSetKey(chatId), user.id);
  return "sent";
}

export type VerifyResult = "ok" | "wrong-answer" | "expired-or-unknown";

/** Approves the join request once the right answer comes back — the token in
 * callback_data already ties the click to one specific (chatId, userId) pair,
 * so unlike the group captcha there's no separate "wrong user" case: Telegram
 * callback queries always come from whoever the message was sent to. */
export async function verifyJoinRequestCaptcha(
  api: Api,
  chatId: number,
  userId: number,
  token: string,
  answer: number
): Promise<VerifyResult> {
  const redis = getRedis();
  const key = stateKey(chatId, userId);
  const state = await redis.get<JoinRequestCaptchaState>(key);
  if (!state || state.token !== token) return "expired-or-unknown";
  if (state.correctAnswer !== answer) return "wrong-answer";

  await Promise.all([redis.del(key), redis.srem(pendingSetKey(chatId), userId)]);
  await api.approveChatJoinRequest(chatId, userId).catch(() => {});
  await api.deleteMessage(state.promptChatId, state.promptMessageId).catch(() => {});
  return "ok";
}

// Same rationale as captcha.ts's SWEEP_BATCH_SIZE: bounds one webhook's worth
// of ban+unban-equivalent (here, decline) round trips during a burst of
// simultaneous join requests.
const SWEEP_BATCH_SIZE = 50;

/**
 * No persistent worker in this serverless/webhook deployment, and unlike the
 * group captcha there is no "next message in the chat" from the pending user
 * to hang a lazy sweep off of (they aren't a member yet, so they can't post).
 * Instead this piggybacks on the SAME call site as sweepExpiredCaptchas — any
 * other member's message in the group — which fires often enough in an active
 * group; a request whose captcha timed out during a genuinely silent group
 * gets swept the next time anyone talks, exactly like sweepExpiredCaptchas'
 * own documented tradeoff.
 */
export async function sweepExpiredJoinRequestCaptchas(api: Api, chatId: number): Promise<void> {
  const redis = getRedis();
  const pending = await redis.smembers<string[]>(pendingSetKey(chatId));
  if (!pending || pending.length === 0) return;

  const userIds = pending.slice(0, SWEEP_BATCH_SIZE).map(Number);
  const stillActiveFlags = await Promise.all(userIds.map((userId) => redis.exists(stateKey(chatId, userId))));
  const expiredUserIds = userIds.filter((_, i) => !stillActiveFlags[i]);

  for (const userId of expiredUserIds) {
    await api.declineChatJoinRequest(chatId, userId).catch(() => {});
    await redis.srem(pendingSetKey(chatId), userId);
  }
}

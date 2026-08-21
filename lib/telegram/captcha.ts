import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import { getRedis } from "@/lib/db/redis";
import type { CaptchaType } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";
import { escapeHtml, mentionHtml } from "./format";

// Same rationale as welcome.ts's MAX_WELCOME_MESSAGE_LENGTH, but lower: the
// rules prompt embeds the mention AND boilerplate text around {rules}, on top
// of the rules text itself — a value this size still leaves headroom under
// Telegram's 4096-char sendMessage limit after both expansions.
export const MAX_RULES_TEXT_LENGTH = 3000;

/** Trims and caps an admin-entered rules template. Doesn't escape HTML here —
 * that happens at send time in startCaptcha, same as buildWelcomeText. */
export function normalizeRulesText(raw: string): string {
  return raw.trim().slice(0, MAX_RULES_TEXT_LENGTH);
}

const stateKey = (chatId: number, userId: number) => `captcha:${chatId}:${userId}`;
const pendingSetKey = (chatId: number) => `captcha:pending:${chatId}`;

interface CaptchaState {
  token: string;
  promptMessageId: number;
  type: CaptchaType;
  /** Only set for type "math" — the one button value that verifies the user. */
  correctAnswer?: number;
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

/** Single-digit addition with 3 distinct, non-negative distractors — hard enough
 * to stop a plain click-bot, easy enough to never trip up a real human. */
function randomMathQuestion(): { a: number; b: number; correct: number; options: number[] } {
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

/** Mutes the new member and posts a "prove you're human" prompt — a one-tap
 * button, or a simple math question when `type` is "math" — with the answer(s)
 * as inline buttons. */
export async function startCaptcha(
  api: Api,
  chatId: number,
  user: User,
  lang: Lang,
  options: { type: CaptchaType; timeoutSeconds: number; rulesText?: string | null }
): Promise<void> {
  const token = randomToken();
  const { type, timeoutSeconds, rulesText } = options;
  const until = Math.floor(Date.now() / 1000) + timeoutSeconds;

  await api
    .restrictChatMember(chatId, user.id, { can_send_messages: false }, { until_date: until })
    .catch(() => {});

  let text: string;
  let correctAnswer: number | undefined;
  let buttons: { text: string; callback_data: string }[];

  if (type === "math") {
    const { a, b, correct, options: answerOptions } = randomMathQuestion();
    correctAnswer = correct;
    text = t(lang, "bot.captchaMathPrompt", { user: mentionHtml(user), seconds: timeoutSeconds, a, b });
    buttons = answerOptions.map((value) => ({
      text: String(value),
      callback_data: `cap:${user.id}:${token}:${value}`,
    }));
  } else if (type === "rules") {
    const rules = rulesText ? escapeHtml(rulesText) : t(lang, "bot.captchaRulesDefault");
    text = t(lang, "bot.captchaRulesPrompt", { user: mentionHtml(user), seconds: timeoutSeconds, rules });
    buttons = [{ text: t(lang, "bot.captchaRulesButton"), callback_data: `cap:${user.id}:${token}` }];
  } else {
    text = t(lang, "bot.captchaPrompt", { user: mentionHtml(user), seconds: timeoutSeconds });
    buttons = [{ text: t(lang, "bot.captchaButton"), callback_data: `cap:${user.id}:${token}` }];
  }

  const inline_keyboard = type === "math" ? [buttons.slice(0, 2), buttons.slice(2)] : [buttons];

  const sent = await api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard },
  });

  const redis = getRedis();
  const state: CaptchaState = { token, promptMessageId: sent.message_id, type, correctAnswer };
  await redis.set(stateKey(chatId, user.id), state, { ex: timeoutSeconds });
  await redis.sadd(pendingSetKey(chatId), user.id);
}

export type VerifyResult = "ok" | "wrong-user" | "wrong-answer" | "expired-or-unknown";

/** Restores full permissions and clears the prompt once the right user clicks the
 * right button — for "math", `answer` must match the stored correct value; for
 * "button" it's ignored (any click from the right user passes, as before). */
export async function verifyCaptcha(
  api: Api,
  chatId: number,
  clickingUserId: number,
  targetUserId: number,
  token: string,
  answer?: number
): Promise<VerifyResult> {
  if (clickingUserId !== targetUserId) return "wrong-user";

  const redis = getRedis();
  const state = await redis.get<CaptchaState>(stateKey(chatId, targetUserId));
  if (!state || state.token !== token) return "expired-or-unknown";
  if (state.type === "math" && state.correctAnswer !== answer) return "wrong-answer";

  await Promise.all([redis.del(stateKey(chatId, targetUserId)), redis.srem(pendingSetKey(chatId), targetUserId)]);

  await api
    .restrictChatMember(chatId, targetUserId, {
      can_send_messages: true,
      can_send_audios: true,
      can_send_documents: true,
      can_send_photos: true,
      can_send_videos: true,
      can_send_video_notes: true,
      can_send_voice_notes: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
    })
    .catch(() => {});
  await api.deleteMessage(chatId, state.promptMessageId).catch(() => {});

  return "ok";
}

/**
 * No persistent worker in this serverless/webhook deployment, so expiry is swept
 * lazily on the next incoming message for that chat rather than on a timer —
 * anyone who never verified in time gets kicked (not banned) the next time
 * someone talks in the group. Cheap: the pending set is normally empty or tiny.
 */
export async function sweepExpiredCaptchas(api: Api, chatId: number): Promise<void> {
  const redis = getRedis();
  const pending = await redis.smembers<string[]>(pendingSetKey(chatId));
  if (!pending || pending.length === 0) return;

  for (const userIdStr of pending) {
    const userId = Number(userIdStr);
    const stillActive = await redis.exists(stateKey(chatId, userId));
    if (stillActive) continue;

    await api.banChatMember(chatId, userId).catch(() => {});
    const unbanned = await api
      .unbanChatMember(chatId, userId, { only_if_banned: true })
      .then(() => true)
      .catch((err) => {
        if (!(err instanceof GrammyError)) throw err;
        return false;
      });
    // Only clear the pending marker once the kick fully round-tripped (ban + unban).
    // If unban failed transiently, leave the marker so the next sweep retries it —
    // otherwise a flaky call here would leave someone permanently banned.
    if (unbanned) {
      await redis.srem(pendingSetKey(chatId), userId);
    }
  }
}

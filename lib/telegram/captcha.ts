import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import { getRedis } from "@/lib/db/redis";
import { t, type Lang } from "@/lib/i18n";
import { mentionHtml } from "./format";

export const CAPTCHA_TIMEOUT_SECONDS = 120;

const stateKey = (chatId: number, userId: number) => `captcha:${chatId}:${userId}`;
const pendingSetKey = (chatId: number) => `captcha:pending:${chatId}`;

interface CaptchaState {
  token: string;
  promptMessageId: number;
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Mutes the new member and posts a "prove you're human" prompt with a callback button. */
export async function startCaptcha(api: Api, chatId: number, user: User, lang: Lang): Promise<void> {
  const token = randomToken();
  const until = Math.floor(Date.now() / 1000) + CAPTCHA_TIMEOUT_SECONDS;

  await api
    .restrictChatMember(chatId, user.id, { can_send_messages: false }, { until_date: until })
    .catch(() => {});

  const sent = await api.sendMessage(
    chatId,
    t(lang, "bot.captchaPrompt", { user: mentionHtml(user), seconds: CAPTCHA_TIMEOUT_SECONDS }),
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: t(lang, "bot.captchaButton"), callback_data: `cap:${user.id}:${token}` }]],
      },
    }
  );

  const redis = getRedis();
  await redis.set(stateKey(chatId, user.id), { token, promptMessageId: sent.message_id } as CaptchaState, {
    ex: CAPTCHA_TIMEOUT_SECONDS,
  });
  await redis.sadd(pendingSetKey(chatId), user.id);
}

export type VerifyResult = "ok" | "wrong-user" | "expired-or-unknown";

/** Restores full permissions and clears the prompt once the right user clicks the button. */
export async function verifyCaptcha(
  api: Api,
  chatId: number,
  clickingUserId: number,
  targetUserId: number,
  token: string
): Promise<VerifyResult> {
  if (clickingUserId !== targetUserId) return "wrong-user";

  const redis = getRedis();
  const state = await redis.get<CaptchaState>(stateKey(chatId, targetUserId));
  if (!state || state.token !== token) return "expired-or-unknown";

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

import type { Message } from "grammy/types";
import { getRedis } from "@/lib/db/redis";
import { hasAnyLink } from "./spam";

const restrictedKey = (chatId: number, userId: number) => `newmember:restrict:${chatId}:${userId}`;

/** Marks a just-joined member as restricted for `minutes` — checked (not
 * consumed) on every message during the window, unlike the one-shot
 * `consumeNewMemberFlag` in flood.ts which only softens the very first
 * message. A no-op for minutes <= 0 so a misconfigured 0 can't set a key
 * Redis would reject anyway. */
export async function markNewMemberRestricted(chatId: number, userId: number, minutes: number): Promise<void> {
  if (minutes <= 0) return;
  await getRedis().set(restrictedKey(chatId, userId), 1, { ex: Math.round(minutes * 60) });
}

export async function isNewMemberRestricted(chatId: number, userId: number): Promise<boolean> {
  return (await getRedis().exists(restrictedKey(chatId, userId))) === 1;
}

/**
 * Forwards, links, and media/stickers are the dominant vectors for freshly-joined
 * spam/scam accounts — a brand-new account leading with any of these in its first
 * few minutes is disproportionately likely to be an ad-forward or a phishing
 * drop, well before content-repetition or AI checks would catch it. Plain text
 * is never restricted here — a genuine newcomer saying hello must never be
 * caught by this.
 */
export function detectRestrictedContent(message: Message): string | null {
  if (message.forward_origin) return "новый участник: пересланное сообщение";
  if (hasAnyLink(message)) return "новый участник: ссылка";
  const hasMediaAttachment = Boolean(
    message.photo || message.video || message.animation || message.document || message.sticker || message.video_note
  );
  if (hasMediaAttachment) return "новый участник: медиа-вложение";
  return null;
}

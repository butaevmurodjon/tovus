import { getRedis } from "./redis";

// Tracks the id of the last auto-posted "message removed" notice in a chat
// (the opt-in `deleteNotice` setting, violations.ts). Only ever one pending
// per chat: the next moderation event deletes the previous notice before
// posting its own, so the notice self-cleans without a timer — a sleep inside
// after() would burn function time against maxDuration for a cosmetic tidy-up.

const NOTICE_TTL_SECONDS = 60 * 60 * 24; // a stale pointer is harmless; just don't keep it forever
const noticeKey = (chatId: number) => `group:${chatId}:autonotice`;

export async function getPendingNotice(chatId: number): Promise<number | null> {
  const id = await getRedis().get<number>(noticeKey(chatId));
  return typeof id === "number" ? id : null;
}

export async function setPendingNotice(chatId: number, messageId: number): Promise<void> {
  await getRedis().set(noticeKey(chatId), messageId, { ex: NOTICE_TTL_SECONDS });
}

export async function clearPendingNotice(chatId: number): Promise<void> {
  await getRedis().del(noticeKey(chatId));
}

import { getRedis } from "@/lib/db/redis";
import {
  DUPLICATE_MAX_COUNT,
  DUPLICATE_WINDOW_SECONDS,
  FLOOD_MAX_MESSAGES,
  FLOOD_WINDOW_SECONDS,
  RAID_JOIN_THRESHOLD,
  RAID_WINDOW_SECONDS,
} from "./spamDict";

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Same user posting many messages in a short window. */
export async function checkUserFlood(chatId: number, userId: number): Promise<boolean> {
  const redis = getRedis();
  const key = `flood:user:${chatId}:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, FLOOD_WINDOW_SECONDS);
  return count > FLOOD_MAX_MESSAGES;
}

/** Same (near-)identical text repeated across the group — mass-forward / bot raid signal. */
export async function checkDuplicateFlood(chatId: number, text: string): Promise<boolean> {
  if (!text || text.trim().length < 8) return false;
  const redis = getRedis();
  const key = `flood:dup:${chatId}:${hashText(text.trim().toLowerCase())}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, DUPLICATE_WINDOW_SECONDS);
  return count > DUPLICATE_MAX_COUNT;
}

/**
 * Pure join-rate detection, independent of group size — N joins within a short
 * window regardless of whether the group has 50 or 5000 members. Returns true
 * for every join for the rest of the window once the threshold is crossed, so
 * every member of the burst (not just the one that tipped it over) gets flagged.
 */
export async function checkRaid(chatId: number): Promise<boolean> {
  const redis = getRedis();
  const key = `raid:${chatId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RAID_WINDOW_SECONDS);
  return count >= RAID_JOIN_THRESHOLD;
}

// Safety net in case a member's first message never arrives (left without posting, etc.) —
// not the leniency window itself. The flag is consumed (deleted) the moment it's read, so
// the softer treatment applies to exactly one message: their first, however soon it comes.
const NEW_MEMBER_TTL_SECONDS = 60 * 60 * 24 * 7;

const newMemberKey = (chatId: number, userId: number) => `newmember:${chatId}:${userId}`;

export async function markNewMember(chatId: number, userId: number): Promise<void> {
  const redis = getRedis();
  await redis.set(newMemberKey(chatId, userId), 1, { ex: NEW_MEMBER_TTL_SECONDS });
}

/** Reads AND clears the flag — only literally the member's first processed message gets it. */
export async function consumeNewMemberFlag(chatId: number, userId: number): Promise<boolean> {
  const redis = getRedis();
  const key = newMemberKey(chatId, userId);
  const value = await redis.get(key);
  if (value === null) return false;
  await redis.del(key);
  return true;
}

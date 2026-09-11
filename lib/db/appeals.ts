import { getRedis } from "./redis";
import type { AppealEntry } from "./types";

// Same hash + sorted-set shape as journal.ts, for the same reason: entries
// need id-addressed lookup/update that survives concurrent inserts (a plain
// Redis List indexed by position is racy for that), plus cheap recency
// ordering for the Mini App list view.
const entriesKey = (chatId: number) => `group:${chatId}:appeals:entries`;
const orderKey = (chatId: number) => `group:${chatId}:appeals:order`;
const MAX_ENTRIES = 200;

export async function addAppeal(entry: AppealEntry): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.hset(entriesKey(entry.chatId), { [entry.id]: entry }),
    redis.zadd(orderKey(entry.chatId), { score: entry.createdAt, member: entry.id }),
  ]);

  const total = await redis.zcard(orderKey(entry.chatId));
  if (total > MAX_ENTRIES) {
    const staleIds = await redis.zrange<string[]>(orderKey(entry.chatId), 0, total - MAX_ENTRIES - 1);
    if (staleIds.length > 0) {
      await Promise.all([
        redis.zrem(orderKey(entry.chatId), ...staleIds),
        redis.hdel(entriesKey(entry.chatId), ...staleIds),
      ]);
    }
  }
}

export async function listAppeals(chatId: number, limit = 50): Promise<AppealEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(orderKey(chatId), 0, limit - 1, { rev: true });
  if (ids.length === 0) return [];
  const entries = await redis.hmget<Record<string, AppealEntry>>(entriesKey(chatId), ...ids);
  if (!entries) return [];
  return ids.map((id) => entries[id]).filter((entry): entry is AppealEntry => entry != null);
}

export async function findAppeal(chatId: number, id: string): Promise<AppealEntry | null> {
  const redis = getRedis();
  const entry = await redis.hget<AppealEntry>(entriesKey(chatId), id);
  return entry ?? null;
}

/** Direct id-addressed write, same as markJournalEntryRestored — no
 * position/index, so no race with a concurrent insert shifting anything. */
export async function setAppealStatus(
  chatId: number,
  id: string,
  status: AppealEntry["status"]
): Promise<AppealEntry | null> {
  const redis = getRedis();
  const entry = await redis.hget<AppealEntry>(entriesKey(chatId), id);
  if (!entry) return null;
  const updated: AppealEntry = { ...entry, status };
  await redis.hset(entriesKey(chatId), { [id]: updated });
  return updated;
}

/** Records an admin's per-case paid-unban price and moves the appeal to
 * "offer_sent" — separate from setAppealStatus since it also has to persist
 * `offerStars`/`offeredAt`, not just flip the status field. */
export async function setAppealOffer(chatId: number, id: string, stars: number): Promise<AppealEntry | null> {
  const redis = getRedis();
  const entry = await redis.hget<AppealEntry>(entriesKey(chatId), id);
  if (!entry) return null;
  const updated: AppealEntry = { ...entry, status: "offer_sent", offerStars: stars, offeredAt: Date.now() };
  await redis.hset(entriesKey(chatId), { [id]: updated });
  return updated;
}

// --- "waiting for the appeal text" private-chat state --------------------

const pendingKey = (userId: number) => `appeal:pending:${userId}`;
// Long enough to type a message after tapping the deep link, short enough
// that a stale "waiting for text" state can't resurrect days later and
// swallow an unrelated private message as an appeal.
const PENDING_TTL_SECONDS = 30 * 60;

/** Records "this user just opened the bot via an appeal deep link for this
 * group, their next private message is the appeal text". Overwrites any
 * earlier pending appeal for the same user (switching groups mid-flow). */
export async function setPendingAppeal(userId: number, chatId: number): Promise<void> {
  await getRedis().set(pendingKey(userId), chatId, { ex: PENDING_TTL_SECONDS });
}

export async function getPendingAppeal(userId: number): Promise<number | null> {
  const raw = await getRedis().get<number | string>(pendingKey(userId));
  if (raw === null || raw === undefined) return null;
  const chatId = Number(raw);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

export async function clearPendingAppeal(userId: number): Promise<void> {
  await getRedis().del(pendingKey(userId)).catch(() => {});
}

// --- per-(group, user) cooldown, so one person can't flood an admin's inbox ---

const cooldownKey = (chatId: number, userId: number) => `appeal:cooldown:${chatId}:${userId}`;
const COOLDOWN_SECONDS = 24 * 60 * 60;

export async function isAppealOnCooldown(chatId: number, userId: number): Promise<boolean> {
  return (await getRedis().exists(cooldownKey(chatId, userId))) === 1;
}

/**
 * Atomically claims the cooldown — SET NX, same pattern as referrals.ts's
 * markRewarded. Returns true only for the caller that actually won the claim,
 * false if it was already on cooldown. Doing the check-and-set as one atomic
 * op (instead of a separate isAppealOnCooldown + this) closes the race where
 * two private messages sent in quick succession both read "not on cooldown"
 * before either had written it — which would otherwise let both through as
 * separate appeals.
 */
export async function tryStartAppealCooldown(chatId: number, userId: number): Promise<boolean> {
  try {
    const res = await getRedis().set(cooldownKey(chatId, userId), 1, { nx: true, ex: COOLDOWN_SECONDS });
    return res === "OK";
  } catch {
    // Fail closed: an unreadable claim must not look like "not on cooldown"
    // and let a duplicate appeal through.
    return false;
  }
}

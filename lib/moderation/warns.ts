import { getRedis } from "@/lib/db/redis";

const warnsKey = (chatId: number, userId: number) => `warns:${chatId}:${userId}`;

/**
 * Records a warn and returns the count of still-active (non-expired) warns
 * for this user in this chat, including the one just recorded. A Sorted Set
 * (score = timestamp) makes "prune anything older than the TTL window" a
 * single ZREMRANGEBYSCORE rather than needing a separate expiry sweep.
 */
export async function recordWarn(chatId: number, userId: number, ttlDays: number): Promise<number> {
  const redis = getRedis();
  const key = warnsKey(chatId, userId);
  const ttlSeconds = Math.max(1, Math.round(ttlDays * 86400));
  const cutoff = Date.now() - ttlSeconds * 1000;

  await redis.zremrangebyscore(key, "-inf", cutoff);
  // Member must be unique per warn (a Sorted Set dedupes by member, not
  // score) — two warns in the same millisecond would otherwise collapse
  // into one entry and silently undercount.
  const member = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  await redis.zadd(key, { score: Date.now(), member });
  await redis.expire(key, ttlSeconds);
  return redis.zcard(key);
}

/** Called once a user's warns escalate into an actual mute/ban — the slate
 * is wiped so they start fresh rather than immediately re-escalating on the
 * strike after their punishment ends. */
export async function clearWarns(chatId: number, userId: number): Promise<void> {
  await getRedis().del(warnsKey(chatId, userId));
}

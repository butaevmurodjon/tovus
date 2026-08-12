import { getRedis } from "@/lib/db/redis";

const warnsKey = (chatId: number, userId: number) => `warns:${chatId}:${userId}`;

// Prune-add-expire-count as one atomic script rather than four separate round
// trips — two concurrent violations from the same user (e.g. two messages
// processed in parallel) previously could each read a stale count between
// each other's commands and both decide to escalate, causing a double
// mute/ban/federation-propagation for a single crossing of the limit.
const RECORD_WARN_SCRIPT = `
  local key = KEYS[1]
  local cutoff = tonumber(ARGV[1])
  local score = tonumber(ARGV[2])
  local member = ARGV[3]
  local ttlSeconds = tonumber(ARGV[4])

  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
  redis.call('ZADD', key, score, member)
  redis.call('EXPIRE', key, ttlSeconds)
  return redis.call('ZCARD', key)
`;

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
  const now = Date.now();
  const cutoff = now - ttlSeconds * 1000;
  // Member must be unique per warn (a Sorted Set dedupes by member, not
  // score) — two warns in the same millisecond would otherwise collapse
  // into one entry and silently undercount.
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  return redis.eval<[number, number, string, number], number>(RECORD_WARN_SCRIPT, [key], [
    cutoff,
    now,
    member,
    ttlSeconds,
  ]);
}

/** Called once a user's warns escalate into an actual mute/ban — the slate
 * is wiped so they start fresh rather than immediately re-escalating on the
 * strike after their punishment ends. */
export async function clearWarns(chatId: number, userId: number): Promise<void> {
  await getRedis().del(warnsKey(chatId, userId));
}

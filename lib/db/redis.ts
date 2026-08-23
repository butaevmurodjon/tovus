import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

/** Lazy singleton so `next build` doesn't crash before env vars are provisioned. */
export function getRedis(): Redis {
  if (!_redis) {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

// TZ.md §9.1, G5: INCR then a separate EXPIRE is two round trips — a crash or
// network partition between them leaves the key incrementing forever with no
// TTL (a permanent leak for a counter that was only ever meant to live for
// one flood/raid window — for FLOOD_MAX_MESSAGES-style counters that means a
// user stuck permanently flood-flagged in that chat). One atomic script
// instead, same round-trip count as the old INCR call on every increment
// after the first (see RECORD_WARN_SCRIPT in warns.ts for the same pattern
// already in this repo). The `TTL == -1` branch also repairs any key that
// already leaked under the old two-call code before this shipped — count==1
// alone would only stop new leaks, not heal existing ones.
const INCR_WITH_TTL_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 or redis.call('TTL', KEYS[1]) == -1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/** Atomically increments `key` and ensures it has a TTL — set on the
 * increment that created it (count === 1), or repaired on any later
 * increment that finds the key persistent (TTL -1), which can only happen
 * from a leak predating this helper. Never resets a TTL that's already
 * counting down normally. */
export async function incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  return getRedis().eval<[number], number>(INCR_WITH_TTL_SCRIPT, [key], [ttlSeconds]);
}

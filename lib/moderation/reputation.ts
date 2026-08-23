import { getRedis } from "@/lib/db/redis";

// §4.5 / §15.7 B2 MVP: an isolated, non-blocking modifier on top of the
// existing binary pipeline — not the full weighted scoring engine (§4).
// Renewed on every hit rather than actively decayed on clean messages (the
// full spec's "amortization"): a per-message decrement would cost a Redis
// write for every message from every user, not just violators. TTL alone
// keeps this bounded — 30 days of silence and the record is gone.
const REP_TTL_SECONDS = 60 * 60 * 24 * 30;
const repKey = (chatId: number, userId: number) => `rep:user:${chatId}:${userId}`;

export const REP_HIT_DELTA = 5;
/** §4.5's "score >= 30 -> modifier" zone, repurposed here as the single MVP
 * effect: at or above this, the user no longer gets the leniency (forceWarnOnly)
 * reserved for possibly-innocent new members/first links — proven repeat
 * offenders lose the benefit of the doubt. Action/severity itself is
 * untouched; this never escalates delete/warn/mute/ban on its own. */
export const REP_STRICT_THRESHOLD = 30;

/** Called once per finalized violation (see bot.ts, right after a verdict is
 * produced) — not per detector hit, so one message triggering both spam and
 * profanity still only counts once. */
export async function recordReputationHit(
  chatId: number,
  userId: number,
  delta: number = REP_HIT_DELTA
): Promise<void> {
  const redis = getRedis();
  const key = repKey(chatId, userId);
  const now = Date.now();

  const [, hitCount] = await Promise.all([redis.hincrby(key, "score", delta), redis.hincrby(key, "hitCount", 1)]);
  const fields: Record<string, number> = { lastHitAt: now };
  if (hitCount === 1) fields.firstSeen = now;
  await redis.hset(key, fields);
  await redis.expire(key, REP_TTL_SECONDS);
}

/** Manual owner override — e.g. clearing a score inflated by a since-fixed
 * false-positive detector (2026-08 profanity filter audit). Deleting the key
 * outright rather than zeroing fields, so a stale firstSeen/hitCount doesn't
 * linger either. */
export async function resetReputation(chatId: number, userId: number): Promise<void> {
  await getRedis().del(repKey(chatId, userId));
}

/** Fail-open by construction: callers only ever get `true` on a confirmed
 * read past the threshold — any Redis error/miss reads as "not a repeat
 * offender", never as an excuse to punish harder. */
export async function isRepeatOffender(
  chatId: number,
  userId: number,
  threshold: number = REP_STRICT_THRESHOLD
): Promise<boolean> {
  const score = await getRedis().hget<number>(repKey(chatId, userId), "score");
  return (score ?? 0) >= threshold;
}

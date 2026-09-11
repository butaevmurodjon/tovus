import { getRedis } from "@/lib/db/redis";
import { computeSimhash, hammingDistance, simhashFromHex, simhashToHex } from "./simhash";

/**
 * Shadow-only near-duplicate tracker — see simhash.ts's docstring for why
 * this is gated to co-occurrence with another spam signal rather than being
 * a standalone detector, and why it only feeds the §4 shadow scorer
 * (scoring.ts), never a real ban/mute/delete.
 *
 * Separate Redis keyspace from flood.ts's dupFloodKey (exact-text counter):
 * this tracks actual fingerprints (not just a count) because near-duplicate
 * matching needs to compare against several recent distinct messages, not
 * increment one counter for one exact string.
 */

const NEAR_DUP_KEY = (chatId: number) => `shadow:simhash:${chatId}`;
const WINDOW_SECONDS = 300; // same horizon as flood.ts's DUPLICATE_WINDOW_SECONDS
const MAX_TRACKED = 40; // cap per chat so a very active chat's key doesn't grow unbounded within the window
const MIN_TEXT_LENGTH = 20; // shorter text is too noisy to fingerprint reliably (see simhash.ts caveat)
// Generous on purpose — the empirical probe found no distance cleanly
// separating reworded-spam from unrelated short chat, so this errs toward
// "record it as evidence for shadow calibration" rather than "decide now".
const MAX_DISTANCE = 24;

export interface NearDuplicateResult {
  matches: number;
  minDistance: number | null;
}

/**
 * Records this message's fingerprint and reports how many of the last
 * WINDOW_SECONDS of (co-occurrence-gated, see caller) messages in this chat
 * are within MAX_DISTANCE bits of it. Always records, even when
 * text is skipped for the current message's own scoring by the caller's
 * gating — future messages still need this one in the window.
 */
export async function checkNearDuplicateShadow(chatId: number, text: string): Promise<NearDuplicateResult | null> {
  if (!text || text.trim().length < MIN_TEXT_LENGTH) return null;
  const hash = computeSimhash(text);
  if (hash === null) return null;

  const redis = getRedis();
  const key = NEAR_DUP_KEY(chatId);
  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  await redis.zremrangebyscore(key, 0, windowStart);
  const recent = (await redis.zrange<string[]>(key, windowStart, now, { byScore: true })) ?? [];

  let matches = 0;
  let minDistance: number | null = null;
  for (const member of recent) {
    const hex = member.split(":")[1];
    if (!hex) continue;
    const distance = hammingDistance(hash, simhashFromHex(hex));
    if (minDistance === null || distance < minDistance) minDistance = distance;
    if (distance <= MAX_DISTANCE) matches++;
  }

  const member = `${now}:${simhashToHex(hash)}:${Math.random().toString(36).slice(2, 8)}`;
  await redis.zadd(key, { score: now, member });
  await redis.expire(key, WINDOW_SECONDS);

  const size = await redis.zcard(key);
  if (size > MAX_TRACKED) {
    const stale = await redis.zrange<string[]>(key, 0, size - MAX_TRACKED - 1);
    if (stale.length > 0) await redis.zrem(key, ...stale);
  }

  return { matches, minDistance };
}

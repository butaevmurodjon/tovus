import { getRedis } from "@/lib/db/redis";

// CAS (Combot Anti-Spam System, cas.chat) — a free, keyless, public API backed
// by a shared database of accounts already banned as spam/scam across every
// group using Combot/Shieldy/CAS-integrated bots. Checking a new joiner
// against it catches professional spam-bot accounts before they ever post a
// single message — something our own content-based filters structurally
// can't do, since there's no message yet to inspect.
const CAS_TIMEOUT_MS = 2500;
const CACHE_TTL_NOT_BANNED_SECONDS = 60 * 60; // 1h — re-check periodically in case CAS adds them later
const CACHE_TTL_BANNED_SECONDS = 60 * 60 * 24; // 24h — a ban record is very unlikely to be reverted

const cacheKey = (userId: number) => `cas:${userId}`;

/**
 * Fails open (returns false) on any network error, timeout, or malformed
 * response — CAS is a third-party dependency outside our control, and a
 * real user's join must never be blocked by it being slow or down.
 */
export async function isCasBanned(userId: number): Promise<boolean> {
  const redis = getRedis();
  const cached = await redis.get<boolean>(cacheKey(userId));
  if (cached !== null && cached !== undefined) return cached;

  let banned = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAS_TIMEOUT_MS);
    const res = await fetch(`https://api.cas.chat/check?user_id=${userId}`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = (await res.json()) as { ok?: boolean };
    banned = data.ok === true;
  } catch {
    return false; // don't cache a failure as a definitive answer
  }

  await redis.set(cacheKey(userId), banned, {
    ex: banned ? CACHE_TTL_BANNED_SECONDS : CACHE_TTL_NOT_BANNED_SECONDS,
  });
  return banned;
}

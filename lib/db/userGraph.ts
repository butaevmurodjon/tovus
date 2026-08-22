import { getRedis } from "./redis";

// §6.1-6.4 B2 MVP (§15.7): the cheapest possible form of "shared_group"
// detection — this user's own join velocity across every group the bot
// manages, not the full pairwise graph:user:{id}:edges adjacency (that's
// Etap 3 in full, deliberately out of MVP scope). A ZSET (not the plain Set
// §7.2 sketches for user:{id}:joinedGroups) because velocity needs "how many
// in the last hour," not just "ever joined."
const JOINED_GROUPS_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days, matches §7.2's key map
const joinedGroupsKey = (userId: number) => `user:${userId}:joinedGroups`;

export async function recordJoinedGroup(userId: number, chatId: number): Promise<void> {
  const redis = getRedis();
  const key = joinedGroupsKey(userId);
  await redis.zadd(key, { score: Date.now(), member: chatId });
  await redis.expire(key, JOINED_GROUPS_TTL_SECONDS);
}

export const JOIN_VELOCITY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const JOIN_VELOCITY_THRESHOLD = 3;

/** Distinct groups (the bot manages) this user has joined within the window. */
export async function countRecentJoinedGroups(
  userId: number,
  windowMs: number = JOIN_VELOCITY_WINDOW_MS
): Promise<number> {
  const redis = getRedis();
  const since = Date.now() - windowMs;
  return redis.zcount(joinedGroupsKey(userId), since, "+inf");
}

/**
 * A weak, non-punitive signal only — never a ban on its own. §6.5's "graph
 * closeness is an unproven correlational signal" applies here just as much
 * as to the full pairwise graph: this only ever forces verification
 * (captcha) and a journal note in bot.ts, mirroring isLikelyAdminImpersonation.
 */
export async function isSuspiciousJoinVelocity(userId: number): Promise<boolean> {
  const count = await countRecentJoinedGroups(userId);
  return count >= JOIN_VELOCITY_THRESHOLD;
}

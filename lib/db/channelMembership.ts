import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { getRedis } from "./redis";

// Membership can change any time (leave/join), unlike member COUNT
// (memberCount.ts) which only needs a coarse size bucket — so this cache is
// much shorter-lived: long enough that a raid/flood of messages from the same
// user doesn't re-hit getChatMember every time, short enough that leaving the
// channel right after joining the group is caught within a few minutes, not
// for the full hour memberCount.ts uses.
const CACHE_TTL_SECONDS = 5 * 60;
const key = (channelId: number, userId: number) => `chanmember:${channelId}:${userId}`;

const NOT_MEMBER_STATUSES = new Set(["left", "kicked"]);

/**
 * True if `userId` is currently a member of `channelId` (any status other
 * than left/kicked — includes "restricted" members of a group, but this is
 * meant for CHANNELS where the only two states that matter in practice are
 * "subscribed" and "left"). Requires the bot to be an admin of that channel —
 * `getChatMember` 403s otherwise, which this treats as "can't verify, don't
 * block" (fail open) rather than "not subscribed", since a broken/missing
 * admin grant is an owner setup problem, not evidence the user isn't
 * subscribed. Callers that gate a real action on this should surface the
 * setup problem separately (e.g. the "missing permissions" banner other
 * checks already use), not rely on this function to report it.
 */
export async function isChannelMember(api: Api, channelId: number, userId: number): Promise<boolean> {
  const redis = getRedis();
  const cacheKey = key(channelId, userId);
  const cached = await redis.get<0 | 1>(cacheKey);
  if (cached !== null && cached !== undefined) return cached === 1;

  try {
    const member = await api.getChatMember(channelId, userId);
    const isMember = !NOT_MEMBER_STATUSES.has(member.status);
    await redis.set(cacheKey, isMember ? 1 : 0, { ex: CACHE_TTL_SECONDS });
    return isMember;
  } catch (err) {
    if (err instanceof GrammyError) return true; // fail open — see doc comment
    throw err;
  }
}

/** Invalidates the cached result — call after a subscribe/unsubscribe prompt
 * so a "join then immediately retry" click isn't stuck reading the stale
 * "not subscribed" answer for the rest of the TTL. */
export async function invalidateChannelMembership(channelId: number, userId: number): Promise<void> {
  await getRedis().del(key(channelId, userId)).catch(() => {});
}

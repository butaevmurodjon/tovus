import { getRedis } from "./redis";

// GROWTH.md §2.4 — referral loop storage.
//
// Three separate keys per inviter, deliberately:
//
//   ref:chats:<inviterId>   SET of chatIds already credited. This is the
//                           dedupe gate AND the source of truth for the count
//                           (`scard`): SADD returns 1 only for a genuinely new
//                           member, atomically, so two concurrent adds of the
//                           same group can never both be credited — a
//                           read-then-write check against a list could.
//   ref:list:<inviterId>    capped display list (same lpush/ltrim/expire
//                           pipeline shape as groupEvents.ts/auditLog.ts),
//                           written ONLY when the SADD above was a real add.
//   ref:rewarded:<inviterId> the payout claim, set with NX so the reward can
//                           be handed out at most once.
//
// TTL note: `pendingRef` is the only short-lived key here (7 days — the window
// between clicking a referral link and actually adding the bot somewhere).
// The credit/count/claim keys get a *long* TTL on purpose: expiring them would
// silently walk an inviter back from 2/3 groups to 0/3 and could re-open an
// already-claimed reward.

const PENDING_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d
const CREDIT_TTL_SECONDS = 60 * 60 * 24 * 365; // 1y — long enough to never expire mid-progress
const MAX_LIST_ENTRIES = 100;

const pendingKey = (inviteeId: number) => `ref:pending:${inviteeId}`;
const chatsKey = (inviterId: number) => `ref:chats:${inviterId}`;
const listKey = (inviterId: number) => `ref:list:${inviterId}`;
const rewardedKey = (inviterId: number) => `ref:rewarded:${inviterId}`;

export interface ReferralRow {
  ts: number;
  chatId: number;
  title: string;
}

/** Pure half of the dedupe rule: has this inviter already been credited for
 * this chat? Callers use it as a cheap pre-check over the (capped) display
 * list so an already-known group short-circuits before any write — the
 * authoritative, race-free gate is still `recordReferral`'s SADD, which is
 * what covers both a concurrent add and an inviter whose history has already
 * been trimmed past MAX_LIST_ENTRIES. */
export function hasReferredChat(rows: ReferralRow[], chatId: number): boolean {
  return rows.some((row) => row && row.chatId === chatId);
}

/** Pure: a referral is only creditable when the inviter is someone else, both
 * ids are real, the group hasn't been credited to this inviter before, and the
 * group is big enough to not be a throwaway. `memberCount === null` means the
 * lookup failed — fail closed (don't credit), same posture as
 * `requiresProForSize` in lib/billing/plan.ts. */
export function isCreditableReferral(params: {
  inviterId: number;
  inviteeId: number;
  chatId: number;
  memberCount: number | null;
  minMembers: number;
  existing: ReferralRow[];
}): boolean {
  const { inviterId, inviteeId, chatId, memberCount, minMembers, existing } = params;
  if (!Number.isSafeInteger(inviterId) || !Number.isSafeInteger(inviteeId)) return false;
  if (inviterId === inviteeId) return false;
  if (memberCount === null || memberCount < minMembers) return false;
  return !hasReferredChat(existing, chatId);
}

/** Remembers "user X arrived via user Y's link" until they actually add the bot
 * somewhere (or 7 days pass, whichever comes first). */
export async function setPendingRef(inviteeId: number, inviterId: number): Promise<void> {
  try {
    await getRedis().set(pendingKey(inviteeId), inviterId, { ex: PENDING_TTL_SECONDS });
  } catch {
    // A lost attribution is a lost reward, never a broken /start.
  }
}

export async function getPendingRef(inviteeId: number): Promise<number | null> {
  const raw = await getRedis().get<number | string>(pendingKey(inviteeId));
  if (raw === null || raw === undefined) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function clearPendingRef(inviteeId: number): Promise<void> {
  await getRedis().del(pendingKey(inviteeId)).catch(() => {});
}

/**
 * Credits `chatId` to `inviterId` exactly once. Returns the inviter's new
 * confirmed-group count, or null when this chat was already credited (or the
 * write failed) — so the caller can tell "crossed the threshold just now" from
 * "was already there".
 */
export async function recordReferral(params: {
  inviterId: number;
  chatId: number;
  chatTitle: string;
}): Promise<number | null> {
  const { inviterId, chatId, chatTitle } = params;
  try {
    const redis = getRedis();
    // SADD is the whole dedupe: 1 = genuinely new, 0 = already counted.
    const added = await redis.sadd(chatsKey(inviterId), chatId);
    if (added !== 1) return null;
    await redis.expire(chatsKey(inviterId), CREDIT_TTL_SECONDS);

    const row: ReferralRow = { ts: Date.now(), chatId, title: chatTitle.slice(0, 120) };
    const pipeline = redis.pipeline();
    pipeline.lpush(listKey(inviterId), row);
    pipeline.ltrim(listKey(inviterId), 0, MAX_LIST_ENTRIES - 1);
    pipeline.expire(listKey(inviterId), CREDIT_TTL_SECONDS);
    await pipeline.exec();

    return await countReferrals(inviterId);
  } catch {
    return null;
  }
}

/** Confirmed distinct groups this user has brought in. */
export async function countReferrals(inviterId: number): Promise<number> {
  try {
    return (await getRedis().scard(chatsKey(inviterId))) ?? 0;
  } catch {
    return 0;
  }
}

/** Newest first. Display only — the count comes from the dedupe SET. */
export async function listReferrals(inviterId: number): Promise<ReferralRow[]> {
  try {
    const raw = (await getRedis().lrange<ReferralRow>(listKey(inviterId), 0, MAX_LIST_ENTRIES - 1)) ?? [];
    return raw.filter(Boolean);
  } catch {
    return [];
  }
}

export async function isRewarded(inviterId: number): Promise<boolean> {
  try {
    return (await getRedis().exists(rewardedKey(inviterId))) === 1;
  } catch {
    // Fail closed: an unreadable claim must not look like "not yet rewarded"
    // and trigger a second payout.
    return true;
  }
}

/**
 * Atomically claims the one-per-inviter reward. Returns true only for the
 * caller that actually won the claim — SET NX, so two concurrent
 * threshold-crossings can't both pay out. Call this BEFORE granting anything,
 * and release with `unmarkRewarded` if the grant itself then fails.
 */
export async function markRewarded(inviterId: number): Promise<boolean> {
  try {
    const res = await getRedis().set(rewardedKey(inviterId), Date.now(), {
      nx: true,
      ex: CREDIT_TTL_SECONDS,
    });
    return res === "OK";
  } catch {
    return false;
  }
}

/** Releases a claim taken by `markRewarded` when the grant it was claimed for
 * didn't actually happen — otherwise a transient failure would burn the
 * inviter's one reward and pay out nothing. */
export async function unmarkRewarded(inviterId: number): Promise<void> {
  await getRedis().del(rewardedKey(inviterId)).catch(() => {});
}

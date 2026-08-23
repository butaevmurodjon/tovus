import { getRedis, incrWithTtl } from "@/lib/db/redis";
import {
  DUPLICATE_MAX_COUNT,
  DUPLICATE_WINDOW_SECONDS,
  FLOOD_MAX_MESSAGES,
  FLOOD_WINDOW_SECONDS,
  RAID_JOIN_THRESHOLD,
  RAID_WINDOW_SECONDS,
} from "./spamDict";

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

const userFloodKey = (chatId: number, userId: number) => `flood:user:${chatId}:${userId}`;
const dupFloodKey = (chatId: number, text: string) => `flood:dup:${chatId}:${hashText(text.trim().toLowerCase())}`;

/** Same user posting many messages in a short window. */
export async function checkUserFlood(chatId: number, userId: number): Promise<boolean> {
  const count = await incrWithTtl(userFloodKey(chatId, userId), FLOOD_WINDOW_SECONDS);
  return count > FLOOD_MAX_MESSAGES;
}

/** Same (near-)identical text repeated across the group — mass-forward / bot raid signal. */
export async function checkDuplicateFlood(chatId: number, text: string): Promise<boolean> {
  if (!text || text.trim().length < 8) return false;
  const count = await incrWithTtl(dupFloodKey(chatId, text), DUPLICATE_WINDOW_SECONDS);
  return count > DUPLICATE_MAX_COUNT;
}

/** Read-only GET, never increments — for the §4 shadow scorer (scoring.ts),
 * which must not double-count toward the real flood threshold by calling
 * checkUserFlood again. Only reflects this exact message if the real
 * pipeline actually incremented the counter for it (antispam on, not an
 * edit, and detectSpam found nothing — see index.ts's gating); otherwise
 * this reads a stale prior count. That means the flood signal below
 * systematically under-fires on messages the old spam-detector already
 * flagged, which is exactly the population most likely to disagree with the
 * new scorer — read shadow-report's divergence numbers with that in mind. */
export async function peekUserFloodCount(chatId: number, userId: number): Promise<number> {
  return (await getRedis().get<number>(userFloodKey(chatId, userId))) ?? 0;
}

/** Read-only counterpart to peekUserFloodCount, same staleness caveat. */
export async function peekDuplicateFloodCount(chatId: number, text: string): Promise<number> {
  if (!text || text.trim().length < 8) return 0;
  return (await getRedis().get<number>(dupFloodKey(chatId, text))) ?? 0;
}

/**
 * Pure join-rate detection, independent of group size — N joins within a short
 * window regardless of whether the group has 50 or 5000 members. Returns true
 * for every join for the rest of the window once the threshold is crossed, so
 * every member of the burst (not just the one that tipped it over) gets flagged.
 */
export async function checkRaid(chatId: number): Promise<boolean> {
  const key = `raid:${chatId}`;
  const count = await incrWithTtl(key, RAID_WINDOW_SECONDS);
  return count >= RAID_JOIN_THRESHOLD;
}

// Safety net in case a member's first message never arrives (left without posting, etc.) —
// not the leniency window itself. The flag is consumed (deleted) the moment it's read, so
// the softer treatment applies to exactly one message: their first, however soon it comes.
const NEW_MEMBER_TTL_SECONDS = 60 * 60 * 24 * 7;

const newMemberKey = (chatId: number, userId: number) => `newmember:${chatId}:${userId}`;
// Separate from newMemberKey on purpose: that one is one-shot (deleted by
// consumeNewMemberFlag on the member's very first message), so by the time
// the §4 shadow scorer runs — after the real pipeline, every message — it's
// often already gone. §4.4/§4.5's "new account (<7 days)" modifier needs to
// be checkable on every message across the whole window, not just the
// first, so it gets its own key that's only ever read (isWithinNewMemberWindow),
// never consumed. Same TTL/window as the one-shot flag.
const newMemberWindowKey = (chatId: number, userId: number) => `newmember:window:${chatId}:${userId}`;

/** Members who joined before this shipped only have the old one-shot key —
 * they'll read isWithinNewMemberWindow === false for the rest of their
 * window (up to 7 days post-deploy), so the shadow scorer's +10 modifier
 * under-fires for that population until it backfills naturally. Not a bug,
 * just a startup transient worth knowing about when reading early
 * shadow-report numbers. */
export async function markNewMember(chatId: number, userId: number): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(newMemberKey(chatId, userId), 1, { ex: NEW_MEMBER_TTL_SECONDS });
  pipeline.set(newMemberWindowKey(chatId, userId), 1, { ex: NEW_MEMBER_TTL_SECONDS });
  await pipeline.exec();
}

/** Read-only, never consumed — unlike consumeNewMemberFlag below. For the §4
 * shadow scorer's new-account modifier only; the real pipeline's own
 * leniency still runs on the one-shot flag. */
export async function isWithinNewMemberWindow(chatId: number, userId: number): Promise<boolean> {
  return (await getRedis().exists(newMemberWindowKey(chatId, userId))) === 1;
}

/** Reads AND clears the flag — only literally the member's first processed
 * message gets it. GETDEL rather than GET-then-DEL (TZ.md §9.1, G2): two
 * messages from a brand-new member processed concurrently used to both read
 * the flag before either deleted it, so both could get the first-message
 * leniency instead of exactly one. */
export async function consumeNewMemberFlag(chatId: number, userId: number): Promise<boolean> {
  const value = await getRedis().getdel<number>(newMemberKey(chatId, userId));
  // Loose equality on purpose: a miss deserializes to `null` (verified against
  // @upstash/redis's parseResponse — a nil REST reply round-trips through
  // JSON.parse(null) to JS null, not undefined), but a live-path inversion
  // here (every never-marked member reading as "first message") is severe
  // enough that guarding the unlikely `undefined` case too costs nothing.
  return value != null;
}

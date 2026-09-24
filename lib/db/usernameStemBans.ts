import { getRedis } from "./redis";
import type { UsernameStemBanEntry } from "./types";

// Same shape as globalBan.ts (single Hash, stem -> entry) — owner-scoped,
// applies everywhere, so there is exactly one list to check regardless of
// group count. Keyed by the *lowercased* stem itself (not a userId — the
// whole point is there's no account yet to key on).
const stemHashKey = "bot:usernamestemban";

/** Minimum stem length before a rule is accepted — guards against an
 * accidental one/two-letter prefix ("а", "an") matching half the group. */
const MIN_STEM_LENGTH = 4;

function normalizeStem(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export function isValidStem(input: string): boolean {
  return normalizeStem(input).length >= MIN_STEM_LENGTH;
}

export async function addUsernameStemBan(entry: UsernameStemBanEntry): Promise<UsernameStemBanEntry> {
  const stem = normalizeStem(entry.stem);
  const normalized: UsernameStemBanEntry = { ...entry, stem };
  await getRedis().hset(stemHashKey, { [stem]: normalized });
  return normalized;
}

export async function removeUsernameStemBan(stem: string): Promise<void> {
  await getRedis().hdel(stemHashKey, normalizeStem(stem));
}

export async function listUsernameStemBans(): Promise<UsernameStemBanEntry[]> {
  const all = await getRedis().hgetall<Record<string, UsernameStemBanEntry>>(stemHashKey);
  if (!all) return [];
  return Object.values(all).sort((a, b) => b.bannedAt - a.bannedAt);
}

/**
 * True when `username` (no leading @, as Telegram's `User.username` gives it)
 * starts with any owner-authored stem — for spam-bot families that rotate
 * only the tail of an otherwise-fixed username per fresh account (e.g. the
 * next `mariya_sharapova_x3q1` after `mariya_sharapova_9r8l` got banned).
 * Small, owner-managed list — an in-memory scan of the whole hash per call is
 * cheap and avoids a second index to keep in sync.
 */
export async function matchesUsernameStemBan(username: string | null | undefined): Promise<UsernameStemBanEntry | null> {
  if (!username) return null;
  const lower = username.toLowerCase();
  const entries = await listUsernameStemBans();
  return entries.find((entry) => lower.startsWith(entry.stem)) ?? null;
}

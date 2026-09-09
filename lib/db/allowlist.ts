import { getRedis } from "./redis";

// Per-group CONTENT allowlist: domains and phrases the spam/link heuristics
// must never flag. Deliberately separate from `group:{chatId}:whitelist`,
// which is a set of trusted *user IDs* (see lib/db/groups.ts, isWhitelisted).
// This one is about message content — an allowed domain (e.g. the group's own
// site) or an allowed phrase — so the two never share a key or a name.

const MAX_ALLOWLIST_ENTRIES = 100;
const MAX_ENTRY_LENGTH = 100;

const key = (chatId: number) => `group:${chatId}:allowlist`;

export async function getAllowlist(chatId: number): Promise<string[]> {
  const entries = await getRedis().smembers<string[]>(key(chatId));
  return (entries ?? []).sort();
}

/** Lowercased, trimmed, length-capped. A bare `@channel` handle is stored as
 * `t.me/channel` so it lines up with how links are extracted from messages. */
export function normalizeAllowlistEntry(raw: string): string | null {
  let entry = raw.trim().toLowerCase();
  if (entry.startsWith("@") && /^@[a-z0-9_]{3,}$/.test(entry)) {
    entry = `t.me/${entry.slice(1)}`;
  }
  entry = entry.replace(/^https?:\/\//, "").replace(/^www\./, "").slice(0, MAX_ENTRY_LENGTH);
  return entry.length > 0 ? entry : null;
}

/** Returns `added: false` (list unchanged) when the group is already at the
 * cap — the caller must surface this, a silent no-op looks like a lost entry. */
export async function addAllowlistEntry(
  chatId: number,
  rawEntry: string
): Promise<{ added: boolean; entries: string[] }> {
  const entry = normalizeAllowlistEntry(rawEntry);
  if (!entry) return { added: false, entries: await getAllowlist(chatId) };
  const redis = getRedis();
  const alreadyPresent = (await redis.sismember(key(chatId), entry)) === 1;
  if (!alreadyPresent) {
    const count = await redis.scard(key(chatId));
    if (count >= MAX_ALLOWLIST_ENTRIES) return { added: false, entries: await getAllowlist(chatId) };
    await redis.sadd(key(chatId), entry);
  }
  return { added: true, entries: await getAllowlist(chatId) };
}

export async function removeAllowlistEntry(chatId: number, rawEntry: string): Promise<string[]> {
  const entry = normalizeAllowlistEntry(rawEntry);
  if (entry) await getRedis().srem(key(chatId), entry);
  return getAllowlist(chatId);
}

export async function clearAllowlist(chatId: number): Promise<void> {
  await getRedis().del(key(chatId));
}

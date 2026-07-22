import { getRedis } from "./redis";
import type { JournalEntry } from "./types";

// A Redis List addressed by position (LPUSH + LSET-by-index) is fundamentally
// racy for "find this entry, then update it": any LPUSH between the read and
// the LSET shifts every existing index, so the write can land on the wrong
// element. Entries are addressed by `id` directly instead — a Hash for O(1)
// id -> entry lookup/update (immune to concurrent inserts), plus a Sorted Set
// for recency ordering (score = timestamp) so listing stays cheap and ordered.
const entriesKey = (chatId: number) => `group:${chatId}:journal:entries`;
const orderKey = (chatId: number) => `group:${chatId}:journal:order`;
const MAX_ENTRIES = 300;

export async function addJournalEntry(entry: JournalEntry): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.hset(entriesKey(entry.chatId), { [entry.id]: entry }),
    redis.zadd(orderKey(entry.chatId), { score: entry.timestamp, member: entry.id }),
  ]);

  const total = await redis.zcard(orderKey(entry.chatId));
  if (total > MAX_ENTRIES) {
    // Oldest-first (ascending score, default zrange order) — trim everything
    // beyond the retained window from BOTH structures so the hash doesn't grow
    // unbounded once entries fall out of range.
    const staleIds = await redis.zrange<string[]>(orderKey(entry.chatId), 0, total - MAX_ENTRIES - 1);
    if (staleIds.length > 0) {
      await Promise.all([
        redis.zrem(orderKey(entry.chatId), ...staleIds),
        redis.hdel(entriesKey(entry.chatId), ...staleIds),
      ]);
    }
  }
}

export async function listJournal(chatId: number, limit = 50): Promise<JournalEntry[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(orderKey(chatId), 0, limit - 1, { rev: true });
  if (ids.length === 0) return [];
  const entries = await redis.hmget<Record<string, JournalEntry>>(entriesKey(chatId), ...ids);
  if (!entries) return [];
  // Preserve recency order from `ids` — hmget's result is keyed by id, not ordered.
  return ids.map((id) => entries[id]).filter((entry): entry is JournalEntry => entry != null);
}

export async function findJournalEntry(chatId: number, id: string): Promise<JournalEntry | null> {
  const redis = getRedis();
  const entry = await redis.hget<JournalEntry>(entriesKey(chatId), id);
  return entry ?? null;
}

/** Direct id-addressed write — no position/index involved, so no race with a
 * concurrent insert shifting anything out from under it. */
export async function markJournalEntryRestored(chatId: number, id: string): Promise<JournalEntry | null> {
  const redis = getRedis();
  const entry = await redis.hget<JournalEntry>(entriesKey(chatId), id);
  if (!entry) return null;
  const updated: JournalEntry = { ...entry, restored: true };
  await redis.hset(entriesKey(chatId), { [id]: updated });
  return updated;
}

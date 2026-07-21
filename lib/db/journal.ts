import { getRedis } from "./redis";
import type { JournalEntry } from "./types";

const journalKey = (chatId: number) => `group:${chatId}:journal`;
const MAX_ENTRIES = 300;

export async function addJournalEntry(entry: JournalEntry): Promise<void> {
  const redis = getRedis();
  await redis.lpush(journalKey(entry.chatId), entry);
  await redis.ltrim(journalKey(entry.chatId), 0, MAX_ENTRIES - 1);
}

export async function listJournal(chatId: number, limit = 50): Promise<JournalEntry[]> {
  const redis = getRedis();
  const items = await redis.lrange<JournalEntry>(journalKey(chatId), 0, limit - 1);
  return items ?? [];
}

export async function findJournalEntry(chatId: number, id: string): Promise<JournalEntry | null> {
  const items = await listJournal(chatId, MAX_ENTRIES);
  return items.find((entry) => entry.id === id) ?? null;
}

export async function markJournalEntryRestored(chatId: number, id: string): Promise<JournalEntry | null> {
  const redis = getRedis();
  const items = await listJournal(chatId, MAX_ENTRIES);
  const index = items.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const updated: JournalEntry = { ...items[index], restored: true };
  await redis.lset(journalKey(chatId), index, updated);
  return updated;
}

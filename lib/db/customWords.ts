import { getRedis } from "./redis";

const MAX_CUSTOM_WORDS = 200;
const MAX_WORD_LENGTH = 64;

const key = (chatId: number) => `group:${chatId}:customwords`;

export async function getCustomWords(chatId: number): Promise<string[]> {
  const words = await getRedis().smembers<string[]>(key(chatId));
  return (words ?? []).sort();
}

export function normalizeCustomWord(raw: string): string | null {
  const word = raw.trim().toLowerCase().slice(0, MAX_WORD_LENGTH);
  return word.length > 0 ? word : null;
}

export async function addCustomWord(chatId: number, rawWord: string): Promise<string[]> {
  const word = normalizeCustomWord(rawWord);
  if (!word) return getCustomWords(chatId);
  const redis = getRedis();
  const count = await redis.scard(key(chatId));
  if (count < MAX_CUSTOM_WORDS) {
    await redis.sadd(key(chatId), word);
  }
  return getCustomWords(chatId);
}

export async function removeCustomWord(chatId: number, rawWord: string): Promise<string[]> {
  const word = normalizeCustomWord(rawWord);
  if (word) await getRedis().srem(key(chatId), word);
  return getCustomWords(chatId);
}

export async function clearCustomWords(chatId: number): Promise<void> {
  await getRedis().del(key(chatId));
}

/** Adds a batch of words (e.g. an industry preset), respecting the same per-group cap. Returns how many were actually added. */
export async function addCustomWords(chatId: number, rawWords: string[]): Promise<{ added: number; words: string[] }> {
  const redis = getRedis();
  const before = await redis.scard(key(chatId));
  const room = Math.max(0, MAX_CUSTOM_WORDS - before);
  const cleaned = Array.from(new Set(rawWords.map(normalizeCustomWord).filter((w): w is string => w !== null)));
  const toAdd = cleaned.slice(0, room);
  // Genuinely-new count, not attempted count: some of `toAdd` may already be in
  // the set (a preset re-applied, or overlap with words a user added manually).
  let added = 0;
  if (toAdd.length > 0) {
    const [first, ...rest] = toAdd;
    added = await redis.sadd(key(chatId), first, ...rest);
  }
  const words = await getCustomWords(chatId);
  return { added, words };
}

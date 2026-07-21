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

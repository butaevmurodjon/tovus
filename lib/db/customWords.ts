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

/** Returns `added: false` (word list unchanged) when the group is already at
 * the cap — the caller must surface this, since silently no-op'ing here would
 * otherwise look like the word vanished for no reason. */
export async function addCustomWord(chatId: number, rawWord: string): Promise<{ added: boolean; words: string[] }> {
  const word = normalizeCustomWord(rawWord);
  if (!word) return { added: false, words: await getCustomWords(chatId) };
  const redis = getRedis();
  const alreadyPresent = (await redis.sismember(key(chatId), word)) === 1;
  if (!alreadyPresent) {
    const count = await redis.scard(key(chatId));
    if (count >= MAX_CUSTOM_WORDS) return { added: false, words: await getCustomWords(chatId) };
    await redis.sadd(key(chatId), word);
  }
  return { added: true, words: await getCustomWords(chatId) };
}

export async function removeCustomWord(chatId: number, rawWord: string): Promise<string[]> {
  const word = normalizeCustomWord(rawWord);
  if (word) await getRedis().srem(key(chatId), word);
  return getCustomWords(chatId);
}

export async function clearCustomWords(chatId: number): Promise<void> {
  await getRedis().del(key(chatId));
}

// SCARD-then-SADD as separate round-trips would be a TOCTOU race: two
// concurrent calls (two presets applied back to back, or a preset racing a
// manual add) could both read the same pre-write count, both see room, and
// both add — overshooting MAX_CUSTOM_WORDS. A Lua script runs atomically on
// the Redis server, so the read-room/add-until-full loop can't interleave
// with anything else touching this key.
const ADD_BATCH_SCRIPT = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local room = max - redis.call('SCARD', key)
if room <= 0 then return 0 end
local added = 0
for i = 2, #ARGV do
  if added >= room then break end
  if redis.call('SADD', key, ARGV[i]) == 1 then added = added + 1 end
end
return added
`;

/** Adds a batch of words (e.g. an industry preset), respecting the same per-group cap. Returns how many were actually added. */
export async function addCustomWords(chatId: number, rawWords: string[]): Promise<{ added: number; words: string[] }> {
  const redis = getRedis();
  const cleaned = Array.from(new Set(rawWords.map(normalizeCustomWord).filter((w): w is string => w !== null)));
  const added =
    cleaned.length > 0
      ? await redis.eval<string[], number>(ADD_BATCH_SCRIPT, [key(chatId)], [String(MAX_CUSTOM_WORDS), ...cleaned])
      : 0;
  const words = await getCustomWords(chatId);
  return { added, words };
}

import { normalizeMessageText } from "./normalize";

/**
 * 64-bit SimHash over character 4-grams — a similarity fingerprint (Charikar
 * 2002; the same 64-bit/Hamming-distance shape Google's web near-duplicate
 * detection uses), for catching reworded/paraphrased spam that
 * flood.ts's checkDuplicateFlood (exact-text match) misses. See
 * MARKET-RESEARCH.md §2 — "neurocommenting": spam-for-hire services that use
 * an LLM to generate a unique, grammatically clean message per chat, which
 * defeats both dictionary matching and exact-duplicate flood detection.
 *
 * Character n-grams (not word n-grams) because they degrade gracefully
 * across mixed RU/UZ-cyrillic text without a per-language tokenizer or
 * stopword list — the same reasoning normalize.ts already uses.
 *
 * IMPORTANT CALIBRATION CAVEAT (found empirically before this shipped, see
 * commit adding this file): on short Telegram-length messages (~10-15
 * words), Hamming distance does NOT cleanly separate genuinely-reworded spam
 * pitches from unrelated short chat — both land in roughly the same 15-40
 * bit range out of 64. The "distance ≤ 3" threshold used for long web
 * documents does not transfer here. Because of that, this is wired ONLY into
 * the shadow scorer (scoring.ts) as a co-occurrence signal — it only
 * contributes when the message already tripped some other spam signal (a
 * link, a CTA phrase, a scam pattern), turning it into "are several
 * differently-worded copies of an already-suspicious message circulating",
 * not a standalone "is this text spam" classifier — and it never gates a
 * real ban/mute/delete on its own. Recalibrate the distance threshold once
 * real shadow-divergence/corpus data exists (see MARKET-RESEARCH.md §4 on
 * why volume alone won't help this — it needs real reworded-spam examples,
 * not more random chat).
 */

const SHINGLE_SIZE = 4;
const HASH_BITS = 64;

/** Two interleaved 32-bit FNV-1a-style hashes combined into one 64-bit
 * BigInt — plenty of bit-spread for shingle hashing; this is a similarity
 * fingerprint, not a security boundary, so a cryptographic hash isn't needed. */
function hashShingle(shingle: string): bigint {
  let h1 = 0x811c9dc5;
  let h2 = (0x1000193 ^ 0xffffffff) >>> 0;
  for (let i = 0; i < shingle.length; i++) {
    const c = shingle.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (BigInt(h1) << BigInt(32)) | BigInt(h2);
}

function shingles(text: string): string[] {
  if (text.length < SHINGLE_SIZE) return [text];
  const result: string[] = [];
  for (let i = 0; i <= text.length - SHINGLE_SIZE; i++) {
    result.push(text.slice(i, i + SHINGLE_SIZE));
  }
  return result;
}

/** Returns null for text too short to fingerprint meaningfully (shorter than one shingle). */
export function computeSimhash(rawText: string): bigint | null {
  const text = normalizeMessageText(rawText);
  if (text.length < SHINGLE_SIZE) return null;

  const one = BigInt(1);
  const bitSums = new Array<number>(HASH_BITS).fill(0);
  for (const shingle of shingles(text)) {
    const hash = hashShingle(shingle);
    for (let bit = 0; bit < HASH_BITS; bit++) {
      bitSums[bit] += (hash >> BigInt(bit)) & one ? 1 : -1;
    }
  }

  let result = BigInt(0);
  for (let bit = 0; bit < HASH_BITS; bit++) {
    if (bitSums[bit] > 0) result |= one << BigInt(bit);
  }
  return result;
}

export function hammingDistance(a: bigint, b: bigint): number {
  const zero = BigInt(0);
  const one = BigInt(1);
  let xor = a ^ b;
  let count = 0;
  while (xor > zero) {
    count += Number(xor & one);
    xor >>= one;
  }
  return count;
}

/** Serializes to a fixed-width hex string (16 chars for 64 bits) for Redis storage. */
export function simhashToHex(hash: bigint): string {
  return hash.toString(16).padStart(16, "0");
}

export function simhashFromHex(hex: string): bigint {
  return BigInt(`0x${hex}`);
}

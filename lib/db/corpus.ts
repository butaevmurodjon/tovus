import { getRedis, incrWithTtl } from "./redis";
import type { ViolationCategory } from "./types";
import type { LangGuess } from "@/lib/moderation/langGuess";
import { normalizeMessageText } from "@/lib/moderation/normalize";

/**
 * Single write point for the moderation training corpus (plan:
 * .claude/plans/delightful-petting-peacock.md). Phase 1 driver is a capped
 * Redis ring buffer — no new infra — behind a driver-agnostic API so Phase 2
 * can swap in Postgres without any caller changing. Every write is one
 * pipelined round trip and is always scheduled off the webhook hot path via
 * `after()` at the call site (same discipline as runShadowScoring).
 *
 * Owner decision (recorded in the plan): full raw text + identity is stored.
 * Safeguards that ride with that choice: the buffer is capped, the whole
 * feature is env-gated (off by default), and reads are owner-only.
 */

const BUFFER_KEY = "corpus:buffer";
// One key PER text hash (not one big hash of all hashes) so each one carries
// its own TTL and actually ages out — a hash-of-everything with a rolling
// EXPIRE would never shrink under continuous traffic. 7-day horizon: a
// template that stops repeating disappears from the dedup set a week later,
// and a still-active one gets re-sampled roughly weekly.
const seenKey = (textHash: string) => `corpus:seen:${textHash}`;
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_BUFFER_MAX = 5000;
const MAX_TEXT = 4000;

export type GoldLabel = "spam" | "scam" | "profanity" | "none";
export type GoldSource = "admin_restore" | "admin_report" | "admin_ban" | "hand_label";
export type AiLabel = "spam" | "scam" | "profanity" | "none";

/** Deterministic-pipeline signal, mirrored from scoring.ts's Signal (name+weight only). */
export interface CorpusSignal {
  name: string;
  weight: number;
}

export interface CorpusSample {
  chatId: number;
  messageId: number;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  /** Raw message text/caption, capped. */
  text: string;
  hasLink: boolean;
  linkDomains: string[];
  mentionCount: number;
  isForward: boolean;
  quotedText: string | null;
  langGuess: LangGuess;
  /** Deterministic verdict from moderateMessage, or null if nothing fired. */
  detVerdict: ViolationCategory | null;
  detSource: string | null;
  detSeverity: string | null;
  detSignals: CorpusSignal[];
  scorerScore: number | null;
  scorerZone: string | null;
  /** DeepSeek verdict when this row was AI-labelled (shadow sample or a real premium verdict). */
  aiLabel: AiLabel | null;
  aiReason: string | null;
  aiModel: string | null;
  aiSampled: boolean;
  /** Confirmed label from a human/admin action. null until reviewed. */
  goldLabel: GoldLabel | null;
  goldSource: GoldSource | null;
  goldBy: number | null;
}

/** Stored buffer row = the sample plus a server-assigned id, timestamp and text hash. */
export interface CorpusRow extends CorpusSample {
  id: string;
  createdAt: number;
  textHash: string;
}

export function corpusEnabled(): boolean {
  const raw = process.env.CORPUS_ENABLED;
  return raw === "1" || raw === "true";
}

/** 1-in-N sampling rate for shadow DeepSeek calls on free-tier traffic. 0 / unset = disabled. */
export function corpusAiSampleRate(): number {
  const n = Number(process.env.CORPUS_AI_SAMPLE_RATE ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function bufferMax(): number {
  const n = Number(process.env.CORPUS_BUFFER_MAX ?? DEFAULT_BUFFER_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BUFFER_MAX;
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable hash of the normalized text — used for dedup and for merging dup
 * counts at export time. Small non-crypto hash (djb2); collisions are
 * harmless here (worst case: two distinct rare messages share a dedup slot). */
export function corpusTextHash(text: string): string {
  const norm = normalizeMessageText(text);
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Records one corpus sample. Deduplicates on the normalized text hash within a
 * 7-day window: the first occurrence pushes a full row, later identical
 * messages only bump a counter (so a spam blast doesn't evict everything else
 * from the ring buffer). Returns what happened, for the caller's logging.
 */
export async function recordCorpusSample(sample: CorpusSample): Promise<"stored" | "duplicate" | "skipped"> {
  if (!corpusEnabled()) return "skipped";
  const redis = getRedis();
  const textHash = sample.text.trim() ? corpusTextHash(sample.text) : `empty:${sample.chatId}:${sample.messageId}`;

  // seenCount === 1 means we're the first to see this text this week. A
  // gold-labelled row (a confirmed admin verdict) is always kept even if a
  // silver row for the same text already exists — the label is the valuable
  // part; the export reconciles the pair by messageId. incrWithTtl (redis.ts)
  // is the repo's atomic INCR+EXPIRE helper, already tested.
  const seenCount = await incrWithTtl(seenKey(textHash), SEEN_TTL_SECONDS);
  if (seenCount > 1 && sample.goldLabel === null) return "duplicate";

  const row: CorpusRow = {
    ...sample,
    text: sample.text.slice(0, MAX_TEXT),
    quotedText: sample.quotedText ? sample.quotedText.slice(0, MAX_TEXT) : null,
    id: randomId(),
    createdAt: Date.now(),
    textHash,
  };

  const pipeline = redis.pipeline();
  pipeline.lpush(BUFFER_KEY, row);
  pipeline.ltrim(BUFFER_KEY, 0, bufferMax() - 1);
  await pipeline.exec();
  return "stored";
}

/** Most-recent-first. For the peek/export scripts and the owner review tool.
 * Exact per-template dup counts aren't tracked in the Phase 1 ring buffer —
 * once this migrates to Postgres, `GROUP BY text_hash` recovers them. */
export async function readCorpusBuffer(limit = 1000): Promise<CorpusRow[]> {
  const raw = await getRedis().lrange<CorpusRow>(BUFFER_KEY, 0, limit - 1);
  return raw ?? [];
}

export async function corpusBufferSize(): Promise<number> {
  return getRedis().llen(BUFFER_KEY);
}

import { getRedis } from "./redis";

/**
 * ROADMAP.md §7.3 "Ежедневная ИИ-сводка чата" — a transient, day-bucketed
 * buffer of message text, ONLY written when both of GroupSettings'
 * dailySummaryEnabled/dailySummaryOwnerAllowed gates are on for a group
 * (see bot.ts's message handler). Deliberately NOT the same storage as
 * corpus.ts's training-data buffer (which is long-retention and gated on
 * CORPUS_ENABLED + separate legal review) — this is short-lived (TTL below,
 * always self-expiring regardless of whether the cron job ever reads it)
 * and exists only to feed one same-day summarization call, never persisted
 * past that.
 *
 * Text-only, capped in both count and per-entry length — the input to a
 * single DeepSeek call has to stay bounded regardless of how chatty a group
 * is, and this is what actually bounds it (the cron job just reads
 * whatever's here, it doesn't do its own capping).
 */
const key = (chatId: number, dateUtc: string) => `dailysummary:${chatId}:${dateUtc}`;
const MAX_ENTRIES = 400;
const MAX_ENTRY_LENGTH = 300;
const TTL_SECONDS = 60 * 60 * 48;

export interface DailySummaryEntry {
  displayName: string;
  text: string;
}

/** "YYYY-MM-DD" in UTC — the bucket a message posted `at` (defaults to now) belongs to. */
export function utcDateBucket(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export async function appendDailySummaryMessage(chatId: number, entry: DailySummaryEntry): Promise<void> {
  const bucket = key(chatId, utcDateBucket());
  const redis = getRedis();
  const trimmed: DailySummaryEntry = {
    displayName: entry.displayName.slice(0, 60),
    text: entry.text.slice(0, MAX_ENTRY_LENGTH),
  };
  const pipeline = redis.pipeline();
  pipeline.rpush(bucket, trimmed);
  // Trim from the front once we're over budget rather than refusing new
  // writes — the cron job wants the FULL day's arc, but a late-day summary
  // for an extremely chatty group is more useful sampling its own recent
  // history than its very first messages of the day.
  pipeline.ltrim(bucket, -MAX_ENTRIES, -1);
  pipeline.expire(bucket, TTL_SECONDS);
  await pipeline.exec();
}

export async function getDailySummaryMessages(chatId: number, dateUtc: string): Promise<DailySummaryEntry[]> {
  const entries = await getRedis().lrange<DailySummaryEntry>(key(chatId, dateUtc), 0, MAX_ENTRIES - 1);
  return entries ?? [];
}

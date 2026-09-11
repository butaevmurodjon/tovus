import { getRedis } from "./redis";
import type { ReasonTag, StatsBucket, ViolationCategory } from "./types";

const STATS_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

const bucketKey = (chatId: number, date: string) => `group:${chatId}:stats:${date}`;

export async function incrementStat(chatId: number, category: ViolationCategory): Promise<void> {
  const redis = getRedis();
  const key = bucketKey(chatId, dateKey(new Date()));
  await redis.hincrby(key, "total", 1);
  await redis.hincrby(key, category, 1);
  await redis.expire(key, STATS_TTL_SECONDS);
}

export function lastNDates(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(dateKey(d));
  }
  return dates;
}

/** Inclusive [start, end] UTC date-key range, one entry per calendar day —
 * unlike lastNDates (anchored to "now"), this serves an arbitrary window, e.g.
 * the monthly digest's trailing-30-days-ending-yesterday range (see
 * getMonthlyDigestStats). Walks by UTC calendar day so it can't skip/repeat a
 * day around a DST-less environment's local-time quirks (this project only
 * ever deals in UTC anyway — see dateKey). */
export function datesBetween(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endKey = dateKey(end);
  while (dateKey(cursor) <= endKey) {
    dates.push(dateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export type StatsPeriod = "today" | "7d" | "30d";

const PERIOD_DAYS: Record<StatsPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export async function getStats(chatId: number, period: StatsPeriod): Promise<StatsBucket> {
  const redis = getRedis();
  const dates = lastNDates(PERIOD_DAYS[period]);
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(bucketKey(chatId, d)))
  );
  return buckets.reduce<StatsBucket>(
    (acc, bucket) => ({
      total: acc.total + Number(bucket?.total ?? 0),
      profanity: acc.profanity + Number(bucket?.profanity ?? 0),
      spam: acc.spam + Number(bucket?.spam ?? 0),
      premium: acc.premium + Number(bucket?.premium ?? 0),
    }),
    { total: 0, profanity: 0, spam: 0, premium: 0 }
  );
}

export interface DailyStatsPoint extends StatsBucket {
  date: string;
}

export async function getDailyStats(chatId: number, days = 14): Promise<DailyStatsPoint[]> {
  const redis = getRedis();
  const dates = lastNDates(days).reverse();
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(bucketKey(chatId, d)))
  );
  return dates.map((date, i) => {
    const bucket = buckets[i];
    return {
      date,
      total: Number(bucket?.total ?? 0),
      profanity: Number(bucket?.profanity ?? 0),
      spam: Number(bucket?.spam ?? 0),
      premium: Number(bucket?.premium ?? 0),
    };
  });
}

// --- Activity (group growth/health, separate from violation counts) ---

const activityKey = (chatId: number, date: string) => `group:${chatId}:activity:${date}`;

export async function incrementActivity(chatId: number, field: "messages" | "joins"): Promise<void> {
  const redis = getRedis();
  const key = activityKey(chatId, dateKey(new Date()));
  await redis.hincrby(key, field, 1);
  await redis.expire(key, STATS_TTL_SECONDS);
}

export interface ActivityBucket {
  messages: number;
  joins: number;
}

export async function getActivity(chatId: number, period: StatsPeriod): Promise<ActivityBucket> {
  const redis = getRedis();
  const dates = lastNDates(PERIOD_DAYS[period]);
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(activityKey(chatId, d)))
  );
  return buckets.reduce<ActivityBucket>(
    (acc, bucket) => ({
      messages: acc.messages + Number(bucket?.messages ?? 0),
      joins: acc.joins + Number(bucket?.joins ?? 0),
    }),
    { messages: 0, joins: 0 }
  );
}

// --- Top active hours (§15.6 B1 — MVP analytics, Pro-gated) ---

const hourlyKey = (chatId: number, date: string) => `group:${chatId}:hourly:${date}`;

/** Same "not on edits" rule as incrementActivity("messages") — called
 * alongside it, never instead of it. */
export async function incrementHourlyActivity(chatId: number): Promise<void> {
  const redis = getRedis();
  const now = new Date();
  const key = hourlyKey(chatId, dateKey(now));
  await redis.hincrby(key, String(now.getUTCHours()), 1);
  await redis.expire(key, STATS_TTL_SECONDS);
}

export interface HourlyActivityPoint {
  hour: number;
  count: number;
}

/** Pure aggregation, separated from the Redis fetch so it's testable without
 * a live store: sums per-hour counts across a set of daily hourly buckets
 * into a fixed 24-length (hour 0..23) array. */
export function aggregateHourlyBuckets(buckets: (Record<string, number> | null)[]): HourlyActivityPoint[] {
  const totals = new Array<number>(24).fill(0);
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const [hourStr, count] of Object.entries(bucket)) {
      const hour = Number(hourStr);
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) totals[hour] += Number(count) || 0;
    }
  }
  return totals.map((count, hour) => ({ hour, count }));
}

export async function getTopActiveHours(chatId: number, period: StatsPeriod): Promise<HourlyActivityPoint[]> {
  const redis = getRedis();
  const dates = lastNDates(PERIOD_DAYS[period]);
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(hourlyKey(chatId, d)))
  );
  return aggregateHourlyBuckets(buckets);
}

// --- Reason tags (monthly digest breakdown) — additive to the existing
// category buckets above, never a replacement. Same date-bucketed
// hash-per-day shape/TTL as incrementStat/bucketKey, just a separate key
// prefix so today/7d/30d screens and the owner overview (which read
// bucketKey only) are untouched. ---

// A Record, not a bare array — typed against ReasonTag so TS itself rejects
// this literal if a tag is ever added to/removed from the union without a
// matching update here (a plain `ReasonTag[]` gets no such check; adding a
// 12th ReasonTag would compile fine and silently drop its counts from
// `total`). lib/telegram/monthlyDigest.test.ts cross-checks its own TAG_ORDER
// against this list too, since that one DOES need array shape (display order).
const REASON_TAG_MEMBERSHIP: Record<ReasonTag, true> = {
  profanity: true,
  scam: true,
  apk: true,
  phishing_link: true,
  ads: true,
  ai: true,
  flood: true,
  cas: true,
  raid: true,
  globalban: true,
  other: true,
};
export const REASON_TAGS = Object.keys(REASON_TAG_MEMBERSHIP) as ReasonTag[];

const reasonTagKey = (chatId: number, date: string) => `group:${chatId}:reasontags:${date}`;

export async function incrementReasonTag(chatId: number, tag: ReasonTag): Promise<void> {
  const redis = getRedis();
  const key = reasonTagKey(chatId, dateKey(new Date()));
  await redis.hincrby(key, tag, 1);
  await redis.expire(key, STATS_TTL_SECONDS);
}

/** Pure aggregation, separated from the Redis fetch for the same testability
 * reason as aggregateHourlyBuckets above: sums per-tag counts across a set of
 * daily reason-tag buckets into a fixed, every-tag-present record. */
export function sumReasonTagBuckets(buckets: (Record<string, number> | null)[]): Record<ReasonTag, number> {
  const totals = Object.fromEntries(REASON_TAGS.map((tag) => [tag, 0])) as Record<ReasonTag, number>;
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const tag of REASON_TAGS) {
      totals[tag] += Number(bucket[tag] ?? 0);
    }
  }
  return totals;
}

async function getReasonTagsForDates(chatId: number, dates: string[]): Promise<Record<ReasonTag, number>> {
  const redis = getRedis();
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(reasonTagKey(chatId, d)))
  );
  return sumReasonTagBuckets(buckets);
}

export interface MonthlyDigestStats {
  total: number;
  byTag: Record<ReasonTag, number>;
}

/**
 * Sums reason-tag counts over an arbitrary [monthStartDate, monthEndDate]
 * window into the monthly digest's shape. The cron route (Task 4) passes a
 * trailing 30-days-ending-yesterday window rather than the previous strict
 * calendar month: digest send days are deliberately spread 1-28 across the
 * month (pickDigestDayOfMonth) precisely so groups don't all fire on day 1,
 * so "previous calendar month" would make a group firing on day 28 report a
 * stat window that closed nearly four weeks earlier. A trailing window always
 * covers the days since roughly the last send, and 30 days comfortably fits
 * inside the 90-day STATS_TTL_SECONDS retention.
 */
export async function getMonthlyDigestStats(
  chatId: number,
  monthStartDate: Date,
  monthEndDate: Date
): Promise<MonthlyDigestStats> {
  const dates = datesBetween(monthStartDate, monthEndDate);
  const byTag = await getReasonTagsForDates(chatId, dates);
  const total = Object.values(byTag).reduce((sum, n) => sum + n, 0);
  return { total, byTag };
}

// --- Monthly digest scheduling (pure — see app/api/cron/monthly-digest) ---

/** No hourly-activity data at all (brand-new group, or an all-zero window) —
 * noon UTC is a defensible single default: it's mid-day somewhere in most of
 * this bot's actual timezone spread (RU/UZ, UTC+3..+5) without betting on any
 * one of them, unlike picking an hour at either edge of the UTC day. */
const DEFAULT_DIGEST_HOUR = 12;

/**
 * Picks the UTC hour with the most message activity to post that group's
 * digest in — landing when the most members are already looking at the chat.
 * Falls back to DEFAULT_DIGEST_HOUR for an empty/all-zero input. Ties pick
 * the lower/earlier hour: hourlyPoints is always ascending by hour (0..23,
 * see aggregateHourlyBuckets), and only a strictly-greater count replaces the
 * running best, so the first (lowest-hour) maximum wins deterministically.
 */
export function pickBestDigestHour(hourlyPoints: HourlyActivityPoint[]): number {
  if (hourlyPoints.length === 0) return DEFAULT_DIGEST_HOUR;
  let best = hourlyPoints[0];
  let sawNonZero = false;
  for (const point of hourlyPoints) {
    if (point.count > 0) sawNonZero = true;
    if (point.count > best.count) best = point;
  }
  return sawNonZero ? best.hour : DEFAULT_DIGEST_HOUR;
}

const bestHourCacheKey = (chatId: number, date: string) => `group:${chatId}:digestbesthour:${date}`;
// A bit over a day — outlives every hourly tick of the one UTC calendar date
// it's keyed by (dateKey uses UTC, so this never needs to survive past that
// date's last possible tick), with slack for clock/scheduling jitter.
const BEST_HOUR_CACHE_TTL_SECONDS = 25 * 60 * 60;

/**
 * Same answer as `pickBestDigestHour(await getTopActiveHours(chatId, "30d"))`,
 * cached per (chatId, calendar date). The cron checks every managed group
 * every hour, but only re-derives this on the FIRST tick of a given UTC date
 * — without caching, a group's digest day would cost up to 24 recomputations
 * (each re-scanning 30 days of hourly buckets = 30 `hgetall` calls) just to
 * keep re-confirming an answer that can't change within the same day.
 */
export async function getCachedBestDigestHour(chatId: number, date: string): Promise<number> {
  const redis = getRedis();
  const key = bestHourCacheKey(chatId, date);
  const cached = await redis.get<number>(key);
  if (cached !== null && cached !== undefined) return cached;

  const hour = pickBestDigestHour(await getTopActiveHours(chatId, "30d"));
  await redis.set(key, hour, { ex: BEST_HOUR_CACHE_TTL_SECONDS });
  return hour;
}

/**
 * Deterministic 1-28 day-of-month for this group's digest — spreads every
 * group's send across the month instead of a thundering herd of every group
 * firing on day 1 at the top of its best hour (Telegram rate limits + a burst
 * of Redis reads). Capped at 28 (never 29-31) so it's a valid day in every
 * month, February included. `Math.abs` matters: Telegram supergroup chatIds
 * are negative (e.g. -1001234567890), and JS `%` preserves the sign of its
 * left operand, so an unguarded `chatId % 28` would return a non-positive
 * number outside the 1-28 contract for almost every real group.
 */
export function pickDigestDayOfMonth(chatId: number): number {
  return (Math.abs(chatId) % 28) + 1;
}

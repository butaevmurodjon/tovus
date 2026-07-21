import { getRedis } from "./redis";
import type { StatsBucket, ViolationCategory } from "./types";

const STATS_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function dateKey(date: Date): string {
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

function lastNDates(n: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(dateKey(d));
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

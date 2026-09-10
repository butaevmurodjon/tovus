import { getRedis } from "./redis";
import { dateKey, lastNDates, type StatsPeriod } from "./stats";

// "Время реакции" — how fast the bot removed a flagged message. Two clocks,
// both recorded per finalized deletion (violations.ts):
//   proc    — webhook-handler entry → deleteMessage confirmed (performance.now,
//             monotonic). This is the part we actually control and optimise:
//             it excludes Telegram→Vercel transit and any cold start before
//             the handler ran.
//   visible — message send/edit time → deleteMessage confirmed (wall clock).
//             Coarser (message.date is second-resolution) but it's the number
//             a member perceives, so it's the one shown in-chat and on the
//             landing page. Skipped when the delta is implausible (clock skew,
//             or an edit of a very old message) so a garbage sample can't drag
//             the average.
// Same per-day hash-bucket shape / 90-day TTL as stats.ts + shadowStats.ts, so
// it reads the same way in Redis with no separate ops story. Split by path
// (base heuristics vs the DeepSeek premium call) because the AI path is
// hundreds of ms to seconds slower and one blended average would be useless
// for both the Pro dashboard and the free-tier speed claim.

const REACTION_TTL_SECONDS = 60 * 60 * 24 * 90;
const reactionKey = (chatId: number, date: string) => `group:${chatId}:reaction:${date}`;

/** Plausibility window for the visible (wall-clock) sample. Below 0 = clock
 * skew; above 10 min = an edit of an old message or a very delayed update. */
const VISIBLE_MIN_MS = 0;
const VISIBLE_MAX_MS = 10 * 60 * 1000;

/** Upper bounds (ms) for the proc-time histogram; last bucket is open-ended.
 * Reaches to 5s so a low-traffic group's cold-start tail (a large share of
 * its total) still resolves a p95 rather than falling in the open bucket. */
const PROC_BUCKET_BOUNDS = [200, 400, 700, 1200, 2500, 5000] as const;

const PROC_FIELDS = [
  ...PROC_BUCKET_BOUNDS.map((b) => `lt${b}`),
  `ge${PROC_BUCKET_BOUNDS[PROC_BUCKET_BOUNDS.length - 1]}`,
] as const;

function procBucketSuffix(ms: number): string {
  for (const bound of PROC_BUCKET_BOUNDS) {
    if (ms < bound) return `lt${bound}`;
  }
  return `ge${PROC_BUCKET_BOUNDS[PROC_BUCKET_BOUNDS.length - 1]}`;
}

export type ReactionPath = "base" | "ai";

export interface RecordReactionParams {
  path: ReactionPath;
  /** Monotonic ms, handler entry → delete confirmed. */
  procMs: number;
  /** Wall-clock ms, message sent → delete confirmed. NaN / out-of-range is
   * simply not recorded (the proc sample still is). */
  visibleMs: number;
}

/** One pipelined round trip regardless of field count — same discipline as
 * recordShadowScoring. Never throws into the caller (caller wraps in
 * .catch(() => {}) and runs it via after()). */
export async function recordReactionTime(chatId: number, params: RecordReactionParams): Promise<void> {
  const redis = getRedis();
  const key = reactionKey(chatId, dateKey(new Date()));
  const p = params.path;
  const proc = Math.max(0, Math.round(params.procMs));
  const pipeline = redis.pipeline();

  pipeline.hincrby(key, `${p}_n`, 1);
  pipeline.hincrby(key, `${p}_proc_sum`, proc);
  pipeline.hincrby(key, `${p}_proc_${procBucketSuffix(proc)}`, 1);

  const vis = Math.round(params.visibleMs);
  if (Number.isFinite(vis) && vis >= VISIBLE_MIN_MS && vis <= VISIBLE_MAX_MS) {
    pipeline.hincrby(key, `${p}_vis_n`, 1);
    pipeline.hincrby(key, `${p}_vis_sum`, vis);
  }

  pipeline.expire(key, REACTION_TTL_SECONDS);
  await pipeline.exec();
}

export interface ReactionPathStats {
  /** Deletions counted (proc sample). */
  count: number;
  meanProcMs: number | null;
  p50ProcMs: number | null;
  p95ProcMs: number | null;
  /** Mean of the plausible visible (send→gone) samples. */
  meanVisibleMs: number | null;
}

export interface ReactionStats {
  base: ReactionPathStats;
  ai: ReactionPathStats;
}

function num(bucket: Record<string, number> | null | undefined, field: string): number {
  return Number(bucket?.[field] ?? 0);
}

/** Upper bound of the first histogram bucket whose cumulative share reaches
 * `p`. `null` when total is 0 or the percentile falls in the open-ended last
 * bucket (can't name an upper bound for "at least Nms"). */
function percentileFromHistogram(counts: number[], p: number): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = total * p;
  let cumulative = 0;
  for (let i = 0; i < PROC_BUCKET_BOUNDS.length; i++) {
    cumulative += counts[i];
    if (cumulative >= target) return PROC_BUCKET_BOUNDS[i];
  }
  return null;
}

/** Pure aggregation over raw per-day hashes — split from the Redis fetch so
 * it's unit-testable without a live store, same as aggregateHourlyBuckets. */
export function aggregateReactionBuckets(buckets: (Record<string, number> | null)[]): ReactionStats {
  const build = (path: ReactionPath): ReactionPathStats => {
    let n = 0;
    let procSum = 0;
    let visN = 0;
    let visSum = 0;
    const hist = new Array<number>(PROC_FIELDS.length).fill(0);
    for (const bucket of buckets) {
      if (!bucket) continue;
      n += num(bucket, `${path}_n`);
      procSum += num(bucket, `${path}_proc_sum`);
      visN += num(bucket, `${path}_vis_n`);
      visSum += num(bucket, `${path}_vis_sum`);
      PROC_FIELDS.forEach((f, i) => {
        hist[i] += num(bucket, `${path}_proc_${f}`);
      });
    }
    return {
      count: n,
      meanProcMs: n === 0 ? null : Math.round(procSum / n),
      p50ProcMs: percentileFromHistogram(hist, 0.5),
      p95ProcMs: percentileFromHistogram(hist, 0.95),
      meanVisibleMs: visN === 0 ? null : Math.round(visSum / visN),
    };
  };
  return { base: build("base"), ai: build("ai") };
}

const PERIOD_DAYS: Record<StatsPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

export async function getReactionStats(chatId: number, period: StatsPeriod): Promise<ReactionStats> {
  const redis = getRedis();
  const dates = lastNDates(PERIOD_DAYS[period]);
  const buckets = await Promise.all(
    dates.map((d) => redis.hgetall<Record<string, number>>(reactionKey(chatId, d)))
  );
  return aggregateReactionBuckets(buckets);
}

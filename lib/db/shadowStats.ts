import { getRedis } from "./redis";
import { dateKey, lastNDates } from "./stats";
import type { ViolationCategory } from "./types";
import type { Zone } from "@/lib/moderation/scoring";

// §4 Этап 1, микро-шаг 5 (TZ.md §11.3): aggregate counters + a bounded sample
// of divergent messages, so the shadow log is both a dashboard (counters) and
// an export (sample) — the two things §11.3's readiness criterion asks for.
// Same 90-day TTL and per-day hash-bucket shape as stats.ts, so it reads the
// same way in Redis and needs no separate ops story.

const SHADOW_STATS_TTL_SECONDS = 60 * 60 * 24 * 90;
const shadowStatsKey = (chatId: number, date: string) => `group:${chatId}:shadowstats:${date}`;

// §7's journal keys cap at 300 entries; reused here for the same reason —
// bounded memory regardless of traffic, most-recent-first for review.
const DIVERGENCE_SAMPLE_LIMIT = 300;
const shadowDivergenceKey = (chatId: number) => `group:${chatId}:shadowdiv`;

/** Upper bounds (ms) for the latency histogram; last bucket is open-ended
 * ("ge250"). A histogram, not raw samples, is the "proxy" §11.3/§11.4 call
 * for — cheap to store, good enough to eyeball whether v2 is anywhere near
 * the §2 budget (p95 ≤250ms) before DeepSeek (step 6) even enters the path. */
const LATENCY_BUCKET_BOUNDS = [10, 25, 50, 100, 250] as const;

export function latencyField(ms: number): string {
  for (const bound of LATENCY_BUCKET_BOUNDS) {
    if (ms < bound) return `lat_lt${bound}`;
  }
  return "lat_ge250";
}

const LATENCY_FIELDS = [...LATENCY_BUCKET_BOUNDS.map((b) => `lat_lt${b}`), "lat_ge250"] as const;

/** Old-pipeline "flagged" is a coarser signal than the new zone (3 levels),
 * so the two combine into a 3x2 cross-tab rather than a single agree/
 * stricter/looser counter — a single collapsed counter would hide *which*
 * zone drives a divergence, and a scorer that's "stricter" only ever at the
 * escalate zone is a different tuning problem than one that's stricter at
 * warn. */
function crossTabField(zone: Zone, oldFlagged: boolean): string {
  return `cmp_${zone}_${oldFlagged ? "flag" : "noflag"}`;
}

export type Divergence = "agree" | "stricter" | "looser";

/** Pure classification, no Redis — null when the old verdict isn't
 * comparable (§4.9's `source` gate, see scoring.ts). "Stricter"/"looser" are
 * relative to the *old* pipeline's binary flagged/not-flagged, not a claim
 * about which one is right (no ground truth here — that's what the
 * divergence sample export is for). */
export function classifyDivergence(
  comparable: boolean,
  oldCategory: ViolationCategory | null,
  zone: Zone
): Divergence | null {
  if (!comparable) return null;
  const oldFlagged = oldCategory !== null;
  const newFlagged = zone !== "ok";
  if (oldFlagged === newFlagged) return "agree";
  return newFlagged ? "stricter" : "looser";
}

export interface DivergenceSample {
  messageId: number;
  score: number;
  zone: Zone;
  oldCategory: ViolationCategory | null;
  divergence: Exclude<Divergence, "agree">;
  signals: { name: string; weight: number }[];
}

export interface RecordShadowScoringParams {
  zone: Zone;
  latencyMs: number;
  comparable: boolean;
  oldCategory: ViolationCategory | null;
  /** §4.5's reputation floor can push zone above "ok" with zero content
   * signals (score 21 from an empty signal list at reputationScore >= 60) —
   * tracked separately so it doesn't get silently read as a content-driven
   * "stricter" divergence in the cross-tab. */
  reputationOnlyTrigger: boolean;
  divergenceSample: DivergenceSample | null;
}

/** One pipelined round-trip (§2's Redis-round-trip budget) regardless of how
 * many fields it touches — matches the "single HGETALL/HSET" discipline the
 * rest of this pipeline already follows (see scoring.ts's one reputation
 * read). Never throws into the caller; the caller already wraps this in
 * .catch(() => {}) the same way it does the reputation read. */
export async function recordShadowScoring(chatId: number, params: RecordShadowScoringParams): Promise<void> {
  const redis = getRedis();
  const key = shadowStatsKey(chatId, dateKey(new Date()));
  const pipeline = redis.pipeline();

  pipeline.hincrby(key, "total", 1);
  pipeline.hincrby(key, `zone_${params.zone}`, 1);
  pipeline.hincrby(key, latencyField(params.latencyMs), 1);
  pipeline.hincrby(key, "latency_sum_ms", Math.round(params.latencyMs));
  if (params.reputationOnlyTrigger) pipeline.hincrby(key, "reputation_only_trigger", 1);
  if (params.comparable) {
    pipeline.hincrby(key, "comparable", 1);
    pipeline.hincrby(key, crossTabField(params.zone, params.oldCategory !== null), 1);
  }
  pipeline.expire(key, SHADOW_STATS_TTL_SECONDS);

  if (params.divergenceSample) {
    const divKey = shadowDivergenceKey(chatId);
    // The SDK JSON-serializes/deserializes objects automatically (same as
    // messageAuthors.ts's cached-message values) — no manual stringify.
    pipeline.lpush(divKey, params.divergenceSample);
    pipeline.ltrim(divKey, 0, DIVERGENCE_SAMPLE_LIMIT - 1);
    pipeline.expire(divKey, SHADOW_STATS_TTL_SECONDS);
  }

  await pipeline.exec();
}

export interface ShadowStatsBucket {
  total: number;
  comparable: number;
  zone: Record<Zone, number>;
  divergence: Record<Divergence, number>;
  reputationOnlyTrigger: number;
  latencyBuckets: Record<(typeof LATENCY_FIELDS)[number], number>;
  latencySumMs: number;
}

function n(bucket: Record<string, number> | null | undefined, field: string): number {
  return Number(bucket?.[field] ?? 0);
}

/** Pure aggregation over raw per-day hashes — split out from the Redis fetch
 * so it's testable without a live store, same as stats.ts's
 * aggregateHourlyBuckets. Derives agree/stricter/looser from the cross-tab
 * counters rather than storing them separately (§4.5 reputation-floor note
 * above: storing a single pre-collapsed counter would hide which zone drives
 * a divergence). */
export function aggregateShadowBuckets(buckets: (Record<string, number> | null)[]): ShadowStatsBucket {
  const result: ShadowStatsBucket = {
    total: 0,
    comparable: 0,
    zone: { ok: 0, warn: 0, escalate: 0 },
    divergence: { agree: 0, stricter: 0, looser: 0 },
    reputationOnlyTrigger: 0,
    latencyBuckets: Object.fromEntries(LATENCY_FIELDS.map((f) => [f, 0])) as ShadowStatsBucket["latencyBuckets"],
    latencySumMs: 0,
  };

  for (const bucket of buckets) {
    if (!bucket) continue;
    result.total += n(bucket, "total");
    result.comparable += n(bucket, "comparable");
    result.reputationOnlyTrigger += n(bucket, "reputation_only_trigger");
    result.latencySumMs += n(bucket, "latency_sum_ms");
    for (const zone of ["ok", "warn", "escalate"] as const) result.zone[zone] += n(bucket, `zone_${zone}`);
    for (const field of LATENCY_FIELDS) result.latencyBuckets[field] += n(bucket, field);

    for (const zone of ["ok", "warn", "escalate"] as const) {
      const flagged = n(bucket, crossTabField(zone, true));
      const noflag = n(bucket, crossTabField(zone, false));
      if (zone === "ok") {
        result.divergence.agree += noflag;
        result.divergence.looser += flagged;
      } else {
        result.divergence.agree += flagged;
        result.divergence.stricter += noflag;
      }
    }
  }

  return result;
}

/** Rough p-th percentile from the latency histogram: the upper bound of the
 * first bucket whose cumulative count reaches `p` fraction of the total.
 * Explicitly a proxy (§11.3) — exact only if a message's true latency never
 * exceeds "ge250"'s open end, which is why that bucket reports as `null`
 * (can't give an upper bound for "at least 250ms"). */
export function estimateLatencyPercentile(
  latencyBuckets: ShadowStatsBucket["latencyBuckets"],
  p: number
): number | null {
  const total = LATENCY_FIELDS.reduce((sum, f) => sum + latencyBuckets[f], 0);
  if (total === 0) return null;
  const target = total * p;
  let cumulative = 0;
  for (let i = 0; i < LATENCY_BUCKET_BOUNDS.length; i++) {
    cumulative += latencyBuckets[LATENCY_FIELDS[i]];
    if (cumulative >= target) return LATENCY_BUCKET_BOUNDS[i];
  }
  return null;
}

export async function getShadowStats(chatId: number, days: number): Promise<ShadowStatsBucket> {
  const redis = getRedis();
  const dates = lastNDates(days);
  const buckets = await Promise.all(dates.map((d) => redis.hgetall<Record<string, number>>(shadowStatsKey(chatId, d))));
  return aggregateShadowBuckets(buckets);
}

export interface ShadowStatsByChatId {
  /** Every group's day-buckets flattened through the same pure aggregator —
   * identical to summing `perGroup`, kept as a separate field so the screen
   * doesn't re-derive it. */
  overall: ShadowStatsBucket;
  /** One row per group that scored at least one message in the window, so
   * `perGroup.length` ≤ the registered-group count the route also returns.
   * No fixed order here — the route sorts. */
  perGroup: { chatId: number; stats: ShadowStatsBucket }[];
}

/** Bot-wide roll-up + per-group breakdown for the owner calibration screen,
 * from one fan-out. Matches owner/overview's existing shape — a cursor pass is
 * tracked separately in ROADMAP §6.1. */
export async function getShadowStatsByChatId(chatIds: number[], days: number): Promise<ShadowStatsByChatId> {
  if (chatIds.length === 0) return { overall: aggregateShadowBuckets([]), perGroup: [] };
  const redis = getRedis();
  const dates = lastNDates(days);
  const perGroupBuckets = await Promise.all(
    chatIds.map((chatId) =>
      Promise.all(dates.map((d) => redis.hgetall<Record<string, number>>(shadowStatsKey(chatId, d))))
    )
  );
  const perGroup = chatIds
    .map((chatId, i) => ({ chatId, stats: aggregateShadowBuckets(perGroupBuckets[i]) }))
    .filter((g) => g.stats.total > 0);
  return { overall: aggregateShadowBuckets(perGroupBuckets.flat()), perGroup };
}

export async function getShadowDivergenceSamples(
  chatId: number,
  limit = DIVERGENCE_SAMPLE_LIMIT,
  offset = 0
): Promise<DivergenceSample[]> {
  const redis = getRedis();
  const raw = await redis.lrange<DivergenceSample>(shadowDivergenceKey(chatId), offset, offset + limit - 1);
  return raw ?? [];
}

/** One pipelined LLEN per group so the owner samples screen can build its
 * group index (title + count) without pulling any buffer's payload — the
 * samples themselves load lazily, one group at a time, when a row is opened. */
export async function countShadowDivergenceSamplesByChatId(
  chatIds: number[]
): Promise<{ chatId: number; count: number }[]> {
  if (chatIds.length === 0) return [];
  const pipeline = getRedis().pipeline();
  for (const chatId of chatIds) pipeline.llen(shadowDivergenceKey(chatId));
  // Default exec() returns the plain results in order ([n, n, …]); the
  // {result,error} wrapper is only the `keepErrors: true` shape.
  const counts = await pipeline.exec<number[]>();
  return chatIds.map((chatId, i) => ({ chatId, count: counts[i] ?? 0 }));
}

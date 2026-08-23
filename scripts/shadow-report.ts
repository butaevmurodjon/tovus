#!/usr/bin/env -S npx tsx
// §4 Этап 1, микро-шаг 5 (TZ.md §11.3): the export/dashboard half of the
// shadow-log metrics. Reads what lib/db/shadowStats.ts writes from
// runShadowScoring (scoring.ts) — never touches live moderation state, this
// is a read-only report for calibrating MODERATION_V2 before flipping it to
// "on" (§11.4's release gates).
//
// Usage:
//   npx tsx scripts/shadow-report.ts                 # all registered groups, last 7 days
//   DAYS=14 npx tsx scripts/shadow-report.ts
//   CHAT_ID=-1001234567890 npx tsx scripts/shadow-report.ts
//   FORMAT=json npx tsx scripts/shadow-report.ts      # machine-readable, for hand-labeling tools

import { getGroupSettings, listAllGroupIds } from "../lib/db/groups";
import { estimateLatencyPercentile, getShadowDivergenceSamples, getShadowStats, type ShadowStatsBucket } from "../lib/db/shadowStats";

const DAYS = Number(process.env.DAYS ?? 7);
const FORMAT = process.env.FORMAT === "json" ? "json" : "text";
const CHAT_ID = process.env.CHAT_ID ? Number(process.env.CHAT_ID) : null;

function pct(part: number, whole: number): string {
  return whole === 0 ? "-" : `${((part / whole) * 100).toFixed(1)}%`;
}

function formatStats(chatId: number, title: string, stats: ShadowStatsBucket): string {
  const lines: string[] = [];
  lines.push(`\n=== ${title} (${chatId}) — last ${DAYS}d ===`);
  lines.push(`total scored: ${stats.total}  comparable: ${stats.comparable} (${pct(stats.comparable, stats.total)})`);
  lines.push(
    `zones: ok ${stats.zone.ok} (${pct(stats.zone.ok, stats.total)})  warn ${stats.zone.warn} (${pct(
      stats.zone.warn,
      stats.total
    )})  escalate ${stats.zone.escalate} (${pct(stats.zone.escalate, stats.total)})`
  );
  const { agree, stricter, looser } = stats.divergence;
  lines.push(
    `vs old pipeline (of ${stats.comparable} comparable): agree ${agree} (${pct(agree, stats.comparable)})  ` +
      `stricter ${stricter} (${pct(stricter, stats.comparable)})  looser ${looser} (${pct(looser, stats.comparable)})`
  );
  lines.push(`reputation-only trigger (empty signals, zone != ok): ${stats.reputationOnlyTrigger}`);
  // estimateLatencyPercentile returns null both when there's no data at all
  // and when the percentile falls in the open-ended ">=250ms" bucket — those
  // mean opposite things for §11.4's p95<=250ms gate, so render them
  // differently rather than collapsing both to "n/a".
  const formatLatency = (p: number) => {
    const value = estimateLatencyPercentile(stats.latencyBuckets, p);
    if (value !== null) return `<${value}ms`;
    return stats.total === 0 ? "n/a" : ">=250ms";
  };
  const p50 = formatLatency(0.5);
  const p95 = formatLatency(0.95);
  const mean = stats.total === 0 ? null : stats.latencySumMs / stats.total;
  lines.push(
    `latency proxy: p50 ${p50}  p95 ${p95}  ` +
      `mean ${mean === null ? "n/a" : `${mean.toFixed(1)}ms`}  (budget: p95 <= 250ms, §2)`
  );
  return lines.join("\n");
}

async function reportGroup(chatId: number) {
  const [settings, stats, samples] = await Promise.all([
    getGroupSettings(chatId),
    getShadowStats(chatId, DAYS),
    getShadowDivergenceSamples(chatId),
  ]);
  const title = settings?.title ?? "(unknown)";

  if (FORMAT === "json") {
    console.log(JSON.stringify({ chatId, title, days: DAYS, stats, divergenceSamples: samples }));
    return;
  }

  console.log(formatStats(chatId, title, stats));
  if (samples.length === 0) {
    console.log("no divergence samples recorded (either MODERATION_V2 isn't shadow/on yet, or old/new always agree)");
    return;
  }
  // Unlike the counters above (scoped to DAYS), this list is the whole
  // 300-slot buffer regardless of date range — note that so it's not read as
  // "divergences in the last DAYS days".
  console.log(`\ndivergence samples (${samples.length} of up to 300, most recent first, all-time — for hand-labeling per §11.4):`);
  for (const s of samples) {
    const signalList = s.signals.map((sig) => `${sig.name}:${sig.weight}`).join(",") || "(none)";
    console.log(
      `  msg ${s.messageId}  ${s.divergence}  score=${s.score} zone=${s.zone} oldCategory=${s.oldCategory ?? "null"}  signals=[${signalList}]`
    );
  }
}

async function main() {
  const chatIds = CHAT_ID !== null ? [CHAT_ID] : await listAllGroupIds();
  if (chatIds.length === 0) {
    console.error("no registered groups found (and CHAT_ID not set)");
    process.exit(1);
  }
  for (const chatId of chatIds) {
    await reportGroup(chatId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

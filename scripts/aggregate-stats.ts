#!/usr/bin/env -S npx tsx
// Read-only aggregate moderation stats across every group the bot manages, for
// public marketing copy. Pulls production Redis via lib/db (no Telegram API
// calls, no writes). Sums getStats(chatId, "30d") and getMonthlyDigestStats
// (trailing 30-days-ending-yesterday, same window as
// app/api/cron/monthly-digest/route.ts) across every chatId from
// listAllGroupIds(). Output is aggregate counts only — no chat/user identity.
//
// Usage:
//   node_modules/.bin/tsx scripts/aggregate-stats.ts
//   FORMAT=json node_modules/.bin/tsx scripts/aggregate-stats.ts

import { listAllGroupIds } from "../lib/db/groups";
import { getStats, getMonthlyDigestStats, REASON_TAGS } from "../lib/db/stats";
import type { ReasonTag } from "../lib/db/types";

const FORMAT = process.env.FORMAT === "json" ? "json" : "text";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const chatIds = await listAllGroupIds();

  // Same trailing 30-days-ending-yesterday window the monthly-digest cron
  // uses (see app/api/cron/monthly-digest/route.ts) so the reason-tag
  // breakdown lines up with the same period as getStats(chatId, "30d").
  const now = new Date();
  const monthEndDate = new Date(now.getTime() - DAY_MS);
  const monthStartDate = new Date(monthEndDate.getTime() - 29 * DAY_MS);

  const totals = { total: 0, profanity: 0, spam: 0, premium: 0 };
  const byTag = Object.fromEntries(REASON_TAGS.map((t) => [t, 0])) as Record<ReasonTag, number>;
  let digestTotal = 0;

  await Promise.all(
    chatIds.map(async (chatId) => {
      const [stats, digest] = await Promise.all([
        getStats(chatId, "30d"),
        getMonthlyDigestStats(chatId, monthStartDate, monthEndDate),
      ]);
      totals.total += stats.total;
      totals.profanity += stats.profanity;
      totals.spam += stats.spam;
      totals.premium += stats.premium;
      digestTotal += digest.total;
      for (const tag of REASON_TAGS) byTag[tag] += digest.byTag[tag];
    })
  );

  if (FORMAT === "json") {
    console.log(
      JSON.stringify({
        groups: chatIds.length,
        window: { start: monthStartDate.toISOString(), end: monthEndDate.toISOString() },
        stats30d: totals,
        reasonTagTotal: digestTotal,
        reasonTagBreakdown: byTag,
      })
    );
    return;
  }

  console.log("=== TG-ATISPAM aggregate moderation stats (production, last 30 days) ===\n");
  console.log(`groups managed:              ${chatIds.length}`);
  console.log(`moderation actions taken:    ${totals.total}`);
  console.log(`  profanity:                 ${totals.profanity}`);
  console.log(`  spam:                      ${totals.spam}`);
  console.log(`  AI-classifier (/premium):  ${totals.premium}`);
  console.log(
    `\nreason-tag breakdown (trailing 30d ending yesterday, total=${digestTotal}) — ` +
      `feature just shipped (see git log for lib/moderation/reasonTags.ts), not enough ` +
      `history yet to be meaningful:`
  );
  const sorted = [...REASON_TAGS].sort((a, b) => byTag[b] - byTag[a]);
  for (const tag of sorted) {
    console.log(`  ${tag.padEnd(14)} ${byTag[tag]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

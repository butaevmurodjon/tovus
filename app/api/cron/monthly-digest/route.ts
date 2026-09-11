import { NextResponse } from "next/server";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, listAllGroupIds, updateGroupSettings } from "@/lib/db/groups";
import { dateKey, getCachedBestDigestHour, getMonthlyDigestStats, pickDigestDayOfMonth } from "@/lib/db/stats";
import { buildDigestMessage } from "@/lib/telegram/monthlyDigest";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function currentYearMonthUtc(now: Date): string {
  return now.toISOString().slice(0, 7); // "YYYY-MM"
}

type GroupOutcome = "sent" | "skipped" | "failed";

/** One group's worth of the cron's per-tick work: figure out whether THIS is
 * the one hour this month this group should get its digest, and send it if
 * so. Every early return here is "skipped", not "failed" — this function
 * runs once an hour for every managed group, so "not this group's moment
 * yet" is the overwhelmingly common outcome, not an error. */
async function processGroup(chatId: number, now: Date): Promise<GroupOutcome> {
  // Pure, zero-I/O, and already excludes ~27/28 of groups on any given day —
  // checked BEFORE the Redis reads below so most groups cost this function
  // nothing every hour except a modulo, not a settings fetch.
  if (now.getUTCDate() !== pickDigestDayOfMonth(chatId)) return "skipped";

  const settings = await getGroupSettings(chatId);
  if (!settings) return "skipped";
  if (settings.monthlyDigestEnabled === false) return "skipped";

  const yearMonth = currentYearMonthUtc(now);
  // Idempotency guard: without this, the hourly cron would re-send for the
  // rest of THIS group's send hour (multiple ticks can land inside the same
  // minute-0..59 hour on a redeploy/retry) and, without the day+hour gate
  // failing on every other day, every hour of every day for the whole month.
  if (settings.lastDigestSentMonth === yearMonth) return "skipped";

  // Cached per (chatId, UTC date) — see getCachedBestDigestHour — so only the
  // FIRST of this group's ~24 eligible-day ticks actually re-scans 30 days of
  // hourly buckets; every later tick that day is a single cheap key read.
  const bestHour = await getCachedBestDigestHour(chatId, dateKey(now));
  if (now.getUTCHours() !== bestHour) return "skipped";

  // Trailing 30-days-ending-yesterday rather than "the previous calendar
  // month" — see getMonthlyDigestStats' doc comment for why: send days are
  // deliberately spread 1-28, so a fixed calendar-month window would make a
  // day-28 group report on a period that closed weeks before its send date.
  const monthEndDate = new Date(now.getTime() - DAY_MS);
  const monthStartDate = new Date(monthEndDate.getTime() - 29 * DAY_MS);
  const stats = await getMonthlyDigestStats(chatId, monthStartDate, monthEndDate);
  const message = buildDigestMessage(stats, settings.lang);

  // The one thing in this route that must be observable (per constraints) —
  // not swallowed behind a best-effort .catch(() => {}) the way stats/journal
  // side effects are elsewhere in this codebase.
  try {
    await getApi().sendMessage(chatId, message);
  } catch {
    return "failed";
  }

  await updateGroupSettings(chatId, { lastDigestSentMonth: yearMonth });
  return "sent";
}

/**
 * Runs hourly (see vercel.json's crons entry). Vercel Cron always calls with
 * an `Authorization: Bearer $CRON_SECRET` header (set automatically when the
 * CRON_SECRET env var exists on the project — nothing to configure in
 * vercel.json's cron entry itself, it only takes path+schedule) — see
 * https://vercel.com/docs/cron-jobs/manage-cron-jobs. The owner must set
 * CRON_SECRET in the Vercel project's env vars for this route to ever
 * authenticate; until then every tick 401s and no digest is ever sent.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const chatIds = await listAllGroupIds();

  // Each group wrapped in its own try/catch so one group's Redis hiccup or
  // unexpected throw can't abort the whole run — same reasoning as the owner
  // overview route's per-group Promise.all (app/api/miniapp/owner/overview).
  const outcomes = await Promise.all(
    chatIds.map(async (chatId): Promise<GroupOutcome> => {
      try {
        return await processGroup(chatId, now);
      } catch {
        return "failed";
      }
    })
  );

  const summary = { total: chatIds.length, sent: 0, skipped: 0, failed: 0 };
  for (const outcome of outcomes) summary[outcome]++;

  return NextResponse.json(summary);
}

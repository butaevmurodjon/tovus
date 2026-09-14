import { NextResponse } from "next/server";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, listAllGroupIds, updateGroupSettings } from "@/lib/db/groups";
import { getDailySummaryMessages, utcDateBucket } from "@/lib/db/dailySummaryBuffer";
import { summarizeDailyChat } from "@/lib/moderation/deepseek";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;

type GroupOutcome = "sent" | "skipped" | "failed";

/**
 * ROADMAP.md §7.3 "Ежедневная ИИ-сводка чата". Both
 * dailySummaryEnabled (group admin) AND dailySummaryOwnerAllowed (bot
 * owner, per group — /api/miniapp/owner/groups/[groupId]/dailysummary)
 * must be on; either one off is a silent skip, same as monthly-digest's
 * own gate. Summarizes TODAY's UTC bucket (this cron is the only reader of
 * dailySummaryBuffer.ts, and runs once near the end of the UTC day — see
 * vercel.json's schedule) rather than "yesterday", so the digest covers
 * the day that's actually ending, not a full day's lag behind.
 */
async function processGroup(chatId: number, today: string): Promise<GroupOutcome> {
  const settings = await getGroupSettings(chatId);
  if (!settings) return "skipped";
  if (!settings.dailySummaryEnabled || !settings.dailySummaryOwnerAllowed) return "skipped";
  if (settings.lastDailySummarySentDate === today) return "skipped";

  const entries = await getDailySummaryMessages(chatId, today);
  if (entries.length === 0) return "skipped";

  const summary = await summarizeDailyChat(entries, settings.lang);
  if (!summary) return "skipped";

  const message = `${t(settings.lang, "bot.dailySummaryHeader")}\n\n${summary}`;
  try {
    await getApi().sendMessage(chatId, message);
  } catch {
    return "failed";
  }

  await updateGroupSettings(chatId, { lastDailySummarySentDate: today });
  return "sent";
}

/**
 * Same CRON_SECRET auth as monthly-digest (see that route's doc comment).
 * A separate cron entry in vercel.json — Vercel Hobby allows 2 daily cron
 * jobs total, so this fits alongside monthly-digest without needing to
 * merge the two into one function.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = utcDateBucket();
  const chatIds = await listAllGroupIds();

  const outcomes = await Promise.all(
    chatIds.map(async (chatId): Promise<GroupOutcome> => {
      try {
        return await processGroup(chatId, today);
      } catch {
        return "failed";
      }
    })
  );

  const summary = { total: chatIds.length, sent: 0, skipped: 0, failed: 0 };
  for (const outcome of outcomes) summary[outcome]++;

  return NextResponse.json(summary);
}

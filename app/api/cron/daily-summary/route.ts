import { NextResponse } from "next/server";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, listAllGroupIds, updateGroupSettings } from "@/lib/db/groups";
import { getDailySummaryMessages, utcDateBucket } from "@/lib/db/dailySummaryBuffer";
import { getOrCreateHubTopic } from "@/lib/db/digestHub";
import { getStats, getActivity } from "@/lib/db/stats";
import { summarizeDailyChat } from "@/lib/moderation/deepseek";
import { t } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;

type GroupOutcome = "sent" | "skipped" | "failed";

function buildDigestMessage(title: string, stats: { messages: number; joins: number; violations: number }, aiSummary: string | null, lang: import("@/lib/i18n").Lang): string {
  const header = `${t(lang, "bot.dailySummaryHeader")} — ${title}`;
  const statsLine = t(lang, "bot.dailySummaryStatsLine", {
    messages: stats.messages,
    joins: stats.joins,
    violations: stats.violations,
  });
  const body = aiSummary ?? t(lang, "bot.dailySummaryNoAiText");
  return `${header}\n\n${statsLine}\n\n${body}`;
}

/**
 * ROADMAP.md §7.3 "Ежедневная ИИ-сводка чата", 2026-09-14 re-cut — owner-only
 * now (`dailySummaryOwnerAllowed`, no group-admin toggle any more), and
 * posts to a separate hub supergroup (`DIGEST_HUB_CHAT_ID`) instead of the
 * source group — one Forum topic per monitored group (lib/db/digestHub.ts).
 * `DIGEST_HUB_CHAT_ID` unset = every group skips, feature fully inert.
 *
 * Combines two independent things into one message per group: the day's
 * plain-number stats (always available, zero AI cost) and the qualitative
 * AI summary (only when there was buffered text and DeepSeek succeeded —
 * see buildDigestMessage's `aiSummary` fallback text for when it didn't).
 */
async function processGroup(hubChatId: number, chatId: number, today: string): Promise<GroupOutcome> {
  const settings = await getGroupSettings(chatId);
  if (!settings) return "skipped";
  if (!settings.dailySummaryOwnerAllowed) return "skipped";
  if (settings.lastDailySummarySentDate === today) return "skipped";

  const [violationStats, activity, entries] = await Promise.all([
    getStats(chatId, "today"),
    getActivity(chatId, "today"),
    getDailySummaryMessages(chatId, today),
  ]);

  const aiSummary = entries.length > 0 ? await summarizeDailyChat(entries, settings.lang) : null;
  const message = buildDigestMessage(
    settings.title,
    { messages: activity.messages, joins: activity.joins, violations: violationStats.total },
    aiSummary,
    settings.lang
  );

  const api = getApi();
  const threadId = await getOrCreateHubTopic(api, hubChatId, chatId, settings.title);
  if (threadId === null) return "failed";

  try {
    await api.sendMessage(hubChatId, message, { message_thread_id: threadId });
  } catch {
    return "failed";
  }

  await updateGroupSettings(chatId, { lastDailySummarySentDate: today });
  return "sent";
}

/**
 * Same CRON_SECRET auth as monthly-digest. A separate cron entry in
 * vercel.json — Vercel Hobby allows 2 daily cron jobs total, this is the
 * 2nd alongside monthly-digest.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hubChatId = Number(process.env.DIGEST_HUB_CHAT_ID);
  if (!process.env.DIGEST_HUB_CHAT_ID || !Number.isFinite(hubChatId)) {
    return NextResponse.json({ total: 0, sent: 0, skipped: 0, failed: 0, note: "DIGEST_HUB_CHAT_ID not configured" });
  }

  const today = utcDateBucket();
  const chatIds = await listAllGroupIds();

  const outcomes = await Promise.all(
    chatIds.map(async (chatId): Promise<GroupOutcome> => {
      try {
        return await processGroup(hubChatId, chatId, today);
      } catch {
        return "failed";
      }
    })
  );

  const summary = { total: chatIds.length, sent: 0, skipped: 0, failed: 0 };
  for (const outcome of outcomes) summary[outcome]++;

  return NextResponse.json(summary);
}

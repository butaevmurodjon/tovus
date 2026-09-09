import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, listAllGroupIds } from "@/lib/db/groups";
import { getActivity, getStats } from "@/lib/db/stats";
import { isProActive, PRO_PRICE_STARS } from "@/lib/billing/plan";
import { getGroupEvents, hasGroupEvents } from "@/lib/db/groupEvents";
import type { OwnerGroupSummary } from "@/lib/db/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const chatIds = await listAllGroupIds();

  const groups = await Promise.all(
    chatIds.map(async (chatId): Promise<OwnerGroupSummary | null> => {
      const settings = await getGroupSettings(chatId);
      if (!settings) return null;
      const [stats, activity] = await Promise.all([
        getStats(chatId, "today").catch(() => ({ total: 0, profanity: 0, spam: 0, premium: 0 })),
        getActivity(chatId, "today").catch(() => ({ messages: 0, joins: 0 })),
      ]);
      return {
        chatId,
        title: settings.title,
        plan: settings.plan,
        isPro: isProActive(settings),
        planExpiresAt: settings.planExpiresAt,
        violationsToday: stats.total,
        joinsToday: activity.joins,
        createdAt: settings.createdAt,
      };
    })
  );

  const summaries = groups.filter((g): g is OwnerGroupSummary => g !== null);

  const now = Date.now();
  const proGroups = summaries.filter((g) => g.isPro).length;
  const newGroups = (days: number) => summaries.filter((g) => now - g.createdAt <= days * DAY_MS).length;

  // Churn comes from the groupEvents log, which only started recording from its
  // deploy forward. Until an event exists, report null (UI shows «нет данных»)
  // rather than 0, which would read as "no churn".
  // One full read of the 30d window; the 7d count is a subset derived in memory.
  const [eventsExist, events30d] = await Promise.all([
    hasGroupEvents().catch(() => false),
    getGroupEvents(now - 30 * DAY_MS).catch(() => []),
  ]);
  const removed30d = events30d.filter((x) => x.type === "removed").length;
  const removed7d = events30d.filter(
    (x) => x.type === "removed" && x.ts >= now - 7 * DAY_MS
  ).length;

  return NextResponse.json({
    totals: {
      groups: summaries.length,
      proGroups,
      violationsToday: summaries.reduce((sum, g) => sum + g.violationsToday, 0),
      joinsToday: summaries.reduce((sum, g) => sum + g.joinsToday, 0),
      // Business tiles (ROADMAP §6.5 item 6) — all derived from the scan above,
      // no extra per-group reads.
      proConversion: summaries.length > 0 ? Math.round((proGroups / summaries.length) * 100) : 0,
      mrrStars: proGroups * PRO_PRICE_STARS,
      newGroups7d: newGroups(7),
      newGroups30d: newGroups(30),
      churn7d: eventsExist ? removed7d : null,
      churn30d: eventsExist ? removed30d : null,
    },
    groups: summaries.sort((a, b) => b.createdAt - a.createdAt),
  });
}

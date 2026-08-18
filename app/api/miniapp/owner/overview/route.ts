import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, listAllGroupIds } from "@/lib/db/groups";
import { getActivity, getStats } from "@/lib/db/stats";
import { isProActive } from "@/lib/billing/plan";
import type { OwnerGroupSummary } from "@/lib/db/types";

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

  return NextResponse.json({
    totals: {
      groups: summaries.length,
      proGroups: summaries.filter((g) => g.isPro).length,
      violationsToday: summaries.reduce((sum, g) => sum + g.violationsToday, 0),
      joinsToday: summaries.reduce((sum, g) => sum + g.joinsToday, 0),
    },
    groups: summaries.sort((a, b) => b.createdAt - a.createdAt),
  });
}

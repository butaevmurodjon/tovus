import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getActivity, getDailyStats, getStats, getTopActiveHours, type StatsPeriod } from "@/lib/db/stats";
import { getReactionStats } from "@/lib/db/reactionStats";
import { getGroupSettings } from "@/lib/db/groups";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { getApi } from "@/lib/telegram/api";
import { canUseProFeature } from "@/lib/billing/plan";

export const runtime = "nodejs";

function parseChatId(groupId: string): number | null {
  const id = Number(groupId);
  return Number.isFinite(id) ? id : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period");
  const period: StatsPeriod = periodParam === "today" || periodParam === "30d" ? periodParam : "7d";

  // §15.6 B1: top-active-hours is the one Pro-gated card on this page, gated
  // with the same eligibility rule (Pro plan OR under the free-tier member
  // grace) as captcha/antiraid and the group settings route.
  const memberCount = await getCachedMemberCount(getApi(), chatId);
  const topHoursEligible = canUseProFeature(settings, memberCount);

  const [summary, daily, activity, topHours, reaction] = await Promise.all([
    getStats(chatId, period),
    getDailyStats(chatId, period === "30d" ? 30 : 14),
    getActivity(chatId, period),
    topHoursEligible ? getTopActiveHours(chatId, period) : Promise.resolve([]),
    getReactionStats(chatId, period),
  ]);

  return NextResponse.json({ period, summary, daily, activity, topHours, topHoursEligible, reaction });
}

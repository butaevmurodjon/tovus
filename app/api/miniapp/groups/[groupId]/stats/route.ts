import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getActivity, getDailyStats, getStats, type StatsPeriod } from "@/lib/db/stats";

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

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period");
  const period: StatsPeriod = periodParam === "today" || periodParam === "30d" ? periodParam : "7d";

  const [summary, daily, activity] = await Promise.all([
    getStats(chatId, period),
    getDailyStats(chatId, period === "30d" ? 30 : 14),
    getActivity(chatId, period),
  ]);

  return NextResponse.json({ period, summary, daily, activity });
}

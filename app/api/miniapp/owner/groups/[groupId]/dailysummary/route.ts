import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, updateGroupSettings } from "@/lib/db/groups";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * ROADMAP.md §7.3 — the bot-owner half of the daily-AI-summary two-gate
 * (see GroupSettings.dailySummaryOwnerAllowed's doc comment). Deliberately
 * NOT reachable through the group's own PATCH route (stripped there
 * explicitly) — only the bot owner can grant or revoke this, per group.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { groupId } = await params;
  const chatId = Number(groupId);
  if (!Number.isInteger(chatId)) {
    return NextResponse.json({ error: "invalid group" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.allowed !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const updated = await updateGroupSettings(chatId, { dailySummaryOwnerAllowed: body.allowed });
  await recordOwnerAudit({
    actorId: user.id,
    action: "daily_summary_toggle",
    target: await groupAuditLabel(chatId),
    detail: body.allowed ? "включено" : "выключено",
  });

  return NextResponse.json({ dailySummaryOwnerAllowed: updated?.dailySummaryOwnerAllowed ?? body.allowed });
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { broadcastToAdmins, broadcastToAllGroups } from "@/lib/telegram/broadcast";
import { recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "text_too_long" }, { status: 400 });

  // "groups" (default, unchanged) posts into every group chat itself;
  // "admins" DMs every user who administers at least one group instead —
  // see broadcastToAdmins's doc comment for why that one also always
  // attaches a "Связь с поддержкой" button.
  const target = body?.target === "admins" ? "admins" : "groups";
  const result = await (target === "admins" ? broadcastToAdmins(getApi(), text) : broadcastToAllGroups(getApi(), text));
  await recordOwnerAudit({
    actorId: user.id,
    action: "broadcast",
    target: target === "admins" ? "админы групп (в личку)" : "все группы",
    detail: text,
    outcome: `${result.sent}/${result.total} доставлено${result.failed ? `, ${result.failed} ошибок` : ""}`,
  });
  return NextResponse.json(result);
}

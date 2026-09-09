import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { isRegisteredGroup } from "@/lib/db/groups";
import { resetReputation } from "@/lib/moderation/reputation";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { groupId } = await params;
  const chatId = Number(groupId);
  if (!Number.isInteger(chatId)) return NextResponse.json({ error: "invalid_group" }, { status: 400 });
  if (!(await isRegisteredGroup(chatId))) {
    return NextResponse.json({ error: "group_unavailable" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid_user" }, { status: 400 });
  }

  const target = `user ${userId} · ${await groupAuditLabel(chatId)}`;
  try {
    await resetReputation(chatId, userId);
  } catch (err) {
    await recordOwnerAudit({ actorId: user.id, action: "group_resetrep", target, outcome: "ошибка" });
    console.error("Owner resetrep failed:", err);
    return NextResponse.json({ error: "resetrep_failed" }, { status: 500 });
  }
  await recordOwnerAudit({ actorId: user.id, action: "group_resetrep", target });
  return NextResponse.json({ ok: true });
}

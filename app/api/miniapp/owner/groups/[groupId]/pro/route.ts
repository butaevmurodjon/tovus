import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getGroupSettings, updateGroupSettings } from "@/lib/db/groups";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";
import { isProActive } from "@/lib/billing/plan";

/**
 * Owner-only manual PRO grant/revoke — the only legitimate writer of
 * `plan`/`planExpiresAt`. The group's own PATCH route (groups/[groupId])
 * strips both fields explicitly for exactly this reason: an admin PATCH must
 * never be able to self-grant PRO.
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
  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (body?.action === "revoke") {
    const updated = await updateGroupSettings(chatId, { plan: "free", planExpiresAt: null });
    await recordOwnerAudit({
      actorId: user.id,
      action: "pro_revoke",
      target: await groupAuditLabel(chatId),
      detail: "снято",
    });
    return NextResponse.json({ settings: updated });
  }

  const days = Number(body?.days);
  if (body?.action !== "grant" || !Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const base = isProActive(settings) && settings.planExpiresAt ? settings.planExpiresAt : Date.now();
  const planExpiresAt = base + days * 24 * 60 * 60 * 1000;
  const updated = await updateGroupSettings(chatId, { plan: "pro", planExpiresAt });
  await recordOwnerAudit({
    actorId: user.id,
    action: "pro_grant",
    target: await groupAuditLabel(chatId),
    detail: `+${days}д`,
  });

  return NextResponse.json({ settings: updated });
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { authorizeOwnerAction, ownerActionErrorStatus } from "@/lib/telegram/ownerActions";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * Owner-panel counterpart to ./ban: lifts a ban for one user in one group.
 * Deliberately narrow — a bot-wide unban already exists (globalban route,
 * DELETE) and removes the global-ban entry too; this one only touches the
 * single chat, for a ban that was applied there (by the bot's moderation, a
 * vote-ban, or the owner's ./ban) without a global-ban record behind it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { groupId } = await params;
  const chatId = Number(groupId);
  if (!Number.isInteger(chatId)) {
    return NextResponse.json({ error: "invalid group" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid user" }, { status: 400 });
  }

  const api = getApi();

  const access = await authorizeOwnerAction(api, chatId, "unban");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  const target = `user ${userId} · ${await groupAuditLabel(chatId)}`;
  try {
    // only_if_banned: a plain unbanChatMember also *removes* a current member
    // (Telegram treats it as "kick without ban") — we only ever want to undo
    // an existing ban here.
    await api.unbanChatMember(chatId, userId, { only_if_banned: true });
    await recordOwnerAudit({ actorId: user.id, action: "group_unban", target });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual owner unban failed:", err);
    await recordOwnerAudit({ actorId: user.id, action: "group_unban", target, outcome: "ошибка" });
    return NextResponse.json({ error: "unban_failed" }, { status: ownerActionErrorStatus(err) });
  }
}

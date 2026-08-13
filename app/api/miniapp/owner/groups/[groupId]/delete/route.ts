import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { authorizeOwnerAction, ownerActionErrorStatus } from "@/lib/telegram/ownerActions";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { groupId } = await params;
  const chatId = Number(groupId);
  if (!Number.isInteger(chatId)) return NextResponse.json({ error: "invalid_group" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const messageId = Number(body?.messageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
  }

  const api = getApi();
  const access = await authorizeOwnerAction(api, chatId, "delete");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  try {
    await api.deleteMessage(chatId, messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual owner delete failed:", err);
    return NextResponse.json({ error: "delete_failed" }, { status: ownerActionErrorStatus(err) });
  }
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { authorizeOwnerAction, ownerActionErrorStatus } from "@/lib/telegram/ownerActions";
import { deleteLastMessage } from "@/lib/telegram/messageCleanup";

export const runtime = "nodejs";

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

  const access = await authorizeOwnerAction(api, chatId, "ban");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  try {
    await api.banChatMember(chatId, userId);
    await deleteLastMessage(api, chatId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual owner ban failed:", err);
    return NextResponse.json({ error: "ban_failed" }, { status: ownerActionErrorStatus(err) });
  }
}

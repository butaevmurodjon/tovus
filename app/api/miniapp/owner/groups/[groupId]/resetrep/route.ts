import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { isRegisteredGroup } from "@/lib/db/groups";
import { resetReputation } from "@/lib/moderation/reputation";

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

  await resetReputation(chatId, userId);
  return NextResponse.json({ ok: true });
}

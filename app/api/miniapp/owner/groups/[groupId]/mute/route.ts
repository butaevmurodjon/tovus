import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { authorizeOwnerAction, ownerActionErrorStatus } from "@/lib/telegram/ownerActions";
import { MUTE_DURATION_SECONDS } from "@/lib/telegram/violations";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * Manual owner-panel mute — the same "restrict, don't remove" counterpart to
 * groups/[groupId]/ban/route.ts, for the "разобрать" flow (a resolved message
 * author). Group-scoped only, same as the ban route: a mute needs a specific
 * chat to restrict in, so there is no "mute everywhere" (a username resolved
 * with no chat context has nowhere to mute in — restrictChatMember on a
 * non-member errors anyway).
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

  const access = await authorizeOwnerAction(api, chatId, "mute");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  const target = `user ${userId} · ${await groupAuditLabel(chatId)}`;
  try {
    await api.restrictChatMember(
      chatId,
      userId,
      {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
      },
      { until_date: Math.floor(Date.now() / 1000) + MUTE_DURATION_SECONDS }
    );
    await recordOwnerAudit({ actorId: user.id, action: "group_mute", target });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Manual owner mute failed:", err);
    await recordOwnerAudit({ actorId: user.id, action: "group_mute", target, outcome: "ошибка" });
    return NextResponse.json({ error: "mute_failed" }, { status: ownerActionErrorStatus(err) });
  }
}

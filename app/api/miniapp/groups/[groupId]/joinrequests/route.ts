import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { listPendingJoinRequests, removePendingJoinRequest } from "@/lib/db/joinRequests";

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

  const entries = await listPendingJoinRequests(chatId);
  return NextResponse.json({ entries });
}

/**
 * Bulk approve/decline — ROADMAP.md §7.3 "Массовое принятие/отклонение
 * заявок". `userIds: "all"` covers the whole known-pending list in one call
 * (the admin-utility Lols itself describes: clearing an accumulated queue
 * in one go); an explicit array acts on just those.
 *
 * Applied one request at a time rather than in parallel — approve/decline
 * calls are on Telegram's normal (not bulk) rate limit, and a large stale
 * queue is exactly the case most likely to trip it if fired all at once.
 * Each result is best-effort: a request Telegram no longer has pending
 * (already resolved natively, or simply expired) fails harmlessly and its
 * local record is still cleaned up either way.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as { action?: "approve" | "decline"; userIds?: number[] | "all" } | null;
  if (body?.action !== "approve" && body?.action !== "decline") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const pending = await listPendingJoinRequests(chatId);
  const requestedIds = body.userIds;
  const targets =
    requestedIds === "all" || requestedIds === undefined
      ? pending.map((p) => p.userId)
      : pending.filter((p) => requestedIds.includes(p.userId)).map((p) => p.userId);

  const api = getApi();
  let succeeded = 0;
  for (const userId of targets) {
    const ok =
      body.action === "approve"
        ? await api.approveChatJoinRequest(chatId, userId).catch(() => false)
        : await api.declineChatJoinRequest(chatId, userId).catch(() => false);
    if (ok !== false) succeeded++;
    // Cleaned up regardless of the API call's own success — a request
    // Telegram already resolved (natively, or it simply expired) has
    // nothing meaningful left to retry, and leaving its local record behind
    // would just make it reappear in every future listing.
    await removePendingJoinRequest(chatId, userId).catch(() => {});
  }

  return NextResponse.json({ processed: targets.length, succeeded });
}

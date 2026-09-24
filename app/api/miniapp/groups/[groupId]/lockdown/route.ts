import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getBotPermissions } from "@/lib/telegram/adminCheck";
import { getLockdownState, type LockdownState } from "@/lib/db/lockdown";
import { lockChat, unlockChat } from "@/lib/telegram/lockdown";

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

  const state: LockdownState | null = await getLockdownState(chatId);
  return NextResponse.json({ locked: state !== null, lockedAt: state?.lockedAt ?? null });
}

/**
 * Chat-wide "read-only mode" — restricts every non-admin from posting
 * (setChatPermissions), the immediate "someone's raiding right now" action,
 * as opposed to any per-user punishment. See lib/telegram/lockdown.ts.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "lock" && action !== "unlock") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const api = getApi();
  const permissions = await getBotPermissions(api, chatId);
  if (!permissions.isAdmin) return NextResponse.json({ error: "bot_not_admin" }, { status: 403 });
  if (!permissions.canRestrictMembers) return NextResponse.json({ error: "missing_restrict_permission" }, { status: 403 });

  try {
    if (action === "lock") {
      await lockChat(api, chatId, auth.user.id);
    } else {
      await unlockChat(api, chatId);
    }
    return NextResponse.json({ ok: true, locked: action === "lock" });
  } catch (err) {
    console.error("Chat lockdown toggle failed:", err);
    return NextResponse.json({ error: "lockdown_failed" }, { status: 500 });
  }
}

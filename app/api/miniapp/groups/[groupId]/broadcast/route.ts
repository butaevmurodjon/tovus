import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings } from "@/lib/db/groups";
import { getFederationTargetChatIds } from "@/lib/telegram/federation";
import { broadcastToChats, consumeAdminBroadcastQuota } from "@/lib/telegram/broadcast";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseChatId(rawGroupId: string): number | null {
  const chatId = Number(rawGroupId);
  return Number.isFinite(chatId) ? chatId : null;
}

/** The Mini App calls this "all my groups" (§15.5), not "other" groups — so
 * unlike getFederationTargetChatIds (built for propagateBan, which
 * deliberately excludes the source since a ban already happened there), this
 * adds the source chat itself back in when IT also has federationEnabled. */
async function resolveBroadcastTargets(sourceChatId: number): Promise<number[]> {
  const [sourceSettings, others] = await Promise.all([
    getGroupSettings(sourceChatId),
    getFederationTargetChatIds(sourceChatId),
  ]);
  return sourceSettings?.federationEnabled ? [sourceChatId, ...others] : others;
}

/** Preview: how many groups a broadcast from here would currently reach —
 * lets the Mini App show a real count in the confirm dialog before sending. */
export async function GET(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId: rawGroupId } = await params;
  const chatId = parseChatId(rawGroupId);
  if (chatId === null) return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const targets = await resolveBroadcastTargets(chatId);
  return NextResponse.json({ targetCount: targets.length });
}

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId: rawGroupId } = await params;
  const chatId = parseChatId(rawGroupId);
  if (chatId === null) return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "text_too_long" }, { status: 400 });

  const targets = await resolveBroadcastTargets(chatId);
  if (targets.length === 0) return NextResponse.json({ total: 0, sent: 0, failed: 0 });

  // Consumed on attempt, not on confirmed delivery: distinguishing "Telegram
  // rejected this send" from "the admin is gaming the quota" isn't reliable,
  // so the simpler, abuse-safe rule is every real attempt costs a slot. The
  // result's `failed` count (surfaced in the Mini App) is the admin's signal
  // that a slot didn't fully land, not a reason to auto-retry it for them.
  if (!(await consumeAdminBroadcastQuota(chatId))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = await broadcastToChats(getApi(), targets, text);
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getCachedMessage } from "@/lib/db/messageAuthors";
import { recordAdminLabel } from "@/lib/moderation/corpusCollector";
import type { GoldLabel } from "@/lib/db/corpus";

export const runtime = "nodejs";

const LABELS: readonly GoldLabel[] = ["spam", "scam", "profanity", "none"];

function isGoldLabel(v: unknown): v is GoldLabel {
  return typeof v === "string" && (LABELS as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { chatId?: unknown; messageId?: unknown; label?: unknown };
  const chatId = Number(body.chatId);
  const messageId = Number(body.messageId);
  if (!Number.isFinite(chatId) || !Number.isFinite(messageId) || !isGoldLabel(body.label)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Text comes from the 30-day author cache, never from the shadow buffer
  // (§11.4: no raw text in metrics). NB: messageAuthors caps text at 500 chars,
  // shorter than corpus MAX_TEXT (4000) — hand-labelled rows carry less text
  // than collectModerationSample rows, which is acceptable for training.
  const cached = await getCachedMessage(chatId, messageId);
  if (!cached?.text.trim()) return NextResponse.json({ result: "no_text" });

  const result = await recordAdminLabel({
    chatId,
    messageId,
    userId: cached.userId,
    text: cached.text,
    goldLabel: body.label,
    goldSource: "hand_label",
    goldBy: user.id,
  });

  return NextResponse.json({ result });
}

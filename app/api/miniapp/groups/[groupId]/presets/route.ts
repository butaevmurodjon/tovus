import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { addCustomWords } from "@/lib/db/customWords";
import { PRESETS, isPresetKey } from "@/lib/moderation/presets";

export const runtime = "nodejs";

function parseChatId(groupId: string): number | null {
  const id = Number(groupId);
  return Number.isFinite(id) ? id : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const preset = body?.preset;
  if (typeof preset !== "string" || !isPresetKey(preset)) {
    return NextResponse.json({ error: "invalid preset" }, { status: 400 });
  }

  const { added, words } = await addCustomWords(chatId, PRESETS[preset]);
  return NextResponse.json({ added, words });
}

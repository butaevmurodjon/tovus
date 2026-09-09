import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { addAllowlistEntry, clearAllowlist, getAllowlist, removeAllowlistEntry } from "@/lib/db/allowlist";

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

  return NextResponse.json({ entries: await getAllowlist(chatId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const entry = typeof body?.entry === "string" ? body.entry : "";
  if (!entry.trim()) return NextResponse.json({ error: "invalid entry" }, { status: 400 });

  const { added, entries } = await addAllowlistEntry(chatId, entry);
  if (!added) return NextResponse.json({ error: "cap reached", entries }, { status: 409 });
  return NextResponse.json({ entries });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    await clearAllowlist(chatId);
    return NextResponse.json({ entries: [] });
  }

  const entry = url.searchParams.get("entry") ?? "";
  if (!entry.trim()) return NextResponse.json({ error: "invalid entry" }, { status: 400 });

  return NextResponse.json({ entries: await removeAllowlistEntry(chatId, entry) });
}

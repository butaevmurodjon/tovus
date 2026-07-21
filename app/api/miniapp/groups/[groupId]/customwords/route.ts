import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { addCustomWord, getCustomWords, removeCustomWord } from "@/lib/db/customWords";

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

  return NextResponse.json({ words: await getCustomWords(chatId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const word = typeof body?.word === "string" ? body.word : "";
  if (!word.trim()) return NextResponse.json({ error: "invalid word" }, { status: 400 });

  return NextResponse.json({ words: await addCustomWord(chatId, word) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const url = new URL(req.url);
  const word = url.searchParams.get("word") ?? "";
  if (!word.trim()) return NextResponse.json({ error: "invalid word" }, { status: 400 });

  return NextResponse.json({ words: await removeCustomWord(chatId, word) });
}

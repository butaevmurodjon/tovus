import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { addToWhitelist, getWhitelist, removeFromWhitelist } from "@/lib/db/groups";

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

  return NextResponse.json({ whitelist: await getWhitelist(chatId) });
}

export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);
  if (!Number.isFinite(userId)) return NextResponse.json({ error: "invalid userId" }, { status: 400 });

  await addToWhitelist(chatId, userId);
  return NextResponse.json({ whitelist: await getWhitelist(chatId) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const url = new URL(req.url);
  const userId = Number(url.searchParams.get("userId"));
  if (!Number.isFinite(userId)) return NextResponse.json({ error: "invalid userId" }, { status: 400 });

  await removeFromWhitelist(chatId, userId);
  return NextResponse.json({ whitelist: await getWhitelist(chatId) });
}

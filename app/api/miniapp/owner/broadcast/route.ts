import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { broadcastToAllGroups } from "@/lib/telegram/broadcast";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "empty_text" }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: "text_too_long" }, { status: 400 });

  const result = await broadcastToAllGroups(getApi(), text);
  return NextResponse.json(result);
}

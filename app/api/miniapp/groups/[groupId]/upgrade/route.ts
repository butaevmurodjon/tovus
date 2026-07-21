import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getGroupSettings } from "@/lib/db/groups";
import { getApi } from "@/lib/telegram/api";
import { createUpgradeInvoiceLink } from "@/lib/telegram/payments";

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

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not found" }, { status: 404 });

  const link = await createUpgradeInvoiceLink(getApi(), chatId, settings.lang);
  return NextResponse.json({ link });
}

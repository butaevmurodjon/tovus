import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getOwnerReminders, setOwnerReminder } from "@/lib/db/ownerReminders";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ reminders: await getOwnerReminders() });
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || typeof body?.value !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  await setOwnerReminder(body.id, body.value);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import {
  addUsernameStemBan,
  isValidStem,
  listUsernameStemBans,
  removeUsernameStemBan,
} from "@/lib/db/usernameStemBans";
import { recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * Owner-authored blocklist for username *prefixes*, not accounts — for spam
 * bot families that rotate only the tail of an otherwise-fixed username per
 * fresh account (e.g. `mariya_sharapova_9r8l`, next `mariya_sharapova_x3q1`).
 * There is no userId to ban here (the next account doesn't exist yet); the
 * rule is checked at join time instead — see lib/telegram/bot.ts.
 */
export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const bans = await listUsernameStemBans();
  return NextResponse.json({ bans });
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const stem = typeof body?.stem === "string" ? body.stem.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!isValidStem(stem)) {
    return NextResponse.json({ error: "invalid_stem" }, { status: 400 });
  }

  const entry = await addUsernameStemBan({
    stem,
    reason: reason || "—",
    bannedAt: Date.now(),
    bannedBy: user.id,
  });
  await recordOwnerAudit({
    actorId: user.id,
    action: "usernameban_add",
    target: `stem "${entry.stem}"`,
    detail: reason || undefined,
  });
  return NextResponse.json({ entry });
}

export async function DELETE(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const stem = searchParams.get("stem") ?? "";
  if (!stem) return NextResponse.json({ error: "invalid_stem" }, { status: 400 });

  await removeUsernameStemBan(stem);
  await recordOwnerAudit({ actorId: user.id, action: "usernameban_remove", target: `stem "${stem}"` });
  return NextResponse.json({ ok: true });
}

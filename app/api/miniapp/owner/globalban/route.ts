import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { isOwner } from "@/lib/owner";
import { listGlobalBans } from "@/lib/db/globalBan";
import { banUserEverywhere, unbanUserEverywhere } from "@/lib/telegram/globalBan";
import { recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const bans = await listGlobalBans();
  return NextResponse.json({ bans });
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid user" }, { status: 400 });
  }

  const result = await banUserEverywhere(getApi(), userId, reason || "—", user.id);
  await recordOwnerAudit({
    actorId: user.id,
    action: "globalban",
    target: `user ${userId}`,
    detail: reason || undefined,
    outcome: `${result.bannedGroups}/${result.totalGroups} групп`,
  });
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const userId = Number(searchParams.get("userId"));
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "invalid user" }, { status: 400 });
  }

  const result = await unbanUserEverywhere(getApi(), userId);
  await recordOwnerAudit({
    actorId: user.id,
    action: "globalunban",
    target: `user ${userId}`,
    outcome: `${result.unbannedGroups}/${result.totalGroups} групп`,
  });
  return NextResponse.json(result);
}

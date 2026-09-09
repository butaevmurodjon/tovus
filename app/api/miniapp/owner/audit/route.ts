import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { listOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) ? Math.min(200, Math.max(1, raw)) : 50;

  return NextResponse.json({ entries: await listOwnerAudit(limit) });
}

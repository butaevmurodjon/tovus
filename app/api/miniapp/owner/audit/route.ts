import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { listOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rawParam = new URL(req.url).searchParams.get("limit");
  const raw = rawParam === null ? NaN : Number(rawParam);
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(200, Math.max(1, raw)) : 50;

  return NextResponse.json({ entries: await listOwnerAudit(limit) });
}

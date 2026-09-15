import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { clearGroupOverrides } from "@/lib/db/groups";
import { isPolicyEligible, POLICY_ELIGIBLE_KEYS, type PolicyKey } from "@/lib/db/policy";
import { groupAuditLabel, recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * The only way an already-registered group (full raw settings blob, see
 * lib/db/groups.ts's registerGroup comment) can adopt the bot-wide policy
 * for fields it already has an explicit value for — drops those fields back
 * out of its own storage so they resolve from policy (or the hardcoded
 * default) on the next read. `keys: "all"` clears every policy-eligible
 * field this group currently has set; an explicit array clears only those.
 */
export async function POST(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { groupId } = await params;
  const chatId = Number(groupId);
  if (!Number.isInteger(chatId)) {
    return NextResponse.json({ error: "invalid group" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  let keys: PolicyKey[];
  if (body?.keys === "all") {
    keys = [...POLICY_ELIGIBLE_KEYS];
  } else if (Array.isArray(body?.keys) && body.keys.every((k: unknown) => typeof k === "string" && isPolicyEligible(k))) {
    keys = body.keys;
  } else {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const updated = await clearGroupOverrides(chatId, keys);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await recordOwnerAudit({
    actorId: user.id,
    action: "policy_apply_to_group",
    target: await groupAuditLabel(chatId),
    detail: body.keys === "all" ? "все поля" : keys.join(", "),
  });

  return NextResponse.json({ settings: updated });
}

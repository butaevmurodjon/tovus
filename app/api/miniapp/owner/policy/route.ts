import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { getPolicy, setPolicyField, clearPolicyField, isPolicyEligible, POLICY_ELIGIBLE_KEYS } from "@/lib/db/policy";
import { recordOwnerAudit } from "@/lib/db/auditLog";

export const runtime = "nodejs";

/**
 * Bot-wide default policy (FAANG-audit §5). GET returns the currently-set
 * policy plus the full eligible-key allowlist (so the UI never has to
 * hardcode it separately from lib/db/policy.ts). POST sets or clears one
 * field. See lib/db/groups.ts's getGroupSettings for how this actually
 * resolves against a group's own settings — nothing here touches any
 * group's stored data directly.
 */
export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const policy = await getPolicy();
  return NextResponse.json({ policy, eligibleKeys: POLICY_ELIGIBLE_KEYS });
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const key = body?.key;
  if (typeof key !== "string" || !isPolicyEligible(key)) {
    return NextResponse.json({ error: "invalid_key" }, { status: 400 });
  }

  if (body?.clear === true) {
    const policy = await clearPolicyField(key);
    await recordOwnerAudit({ actorId: user.id, action: "policy_clear", target: key });
    return NextResponse.json({ policy });
  }

  if (!("value" in body)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const policy = await setPolicyField(key, body.value);
  await recordOwnerAudit({
    actorId: user.id,
    action: "policy_set",
    target: key,
    detail: JSON.stringify(body.value).slice(0, 200),
  });
  return NextResponse.json({ policy });
}

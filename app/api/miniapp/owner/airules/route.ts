import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { addAiRule, listAiRules, removeAiRule, type AiRuleLabel } from "@/lib/db/aiRules";
import { recordOwnerAudit } from "@/lib/db/auditLog";

const ruleTarget = (label: AiRuleLabel) => (label === "violation" ? "правило: нельзя" : "правило: можно");

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rules = await listAiRules();
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const label: AiRuleLabel | undefined = body?.label === "violation" || body?.label === "allowed" ? body.label : undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!label || !text.trim()) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await addAiRule(label, text);
  if (!result.added) return NextResponse.json({ error: "cap_reached" }, { status: 400 });
  await recordOwnerAudit({ actorId: user.id, action: "airule_add", target: ruleTarget(label), detail: text.trim() });
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Capture the rule's text before it's gone — removeAiRule returns only what's left.
  const removed = (await listAiRules()).find((r) => r.id === id);
  const rules = await removeAiRule(id);
  await recordOwnerAudit({
    actorId: user.id,
    action: "airule_remove",
    target: removed ? ruleTarget(removed.label) : `правило ${id}`,
    detail: removed?.text,
  });
  return NextResponse.json({ rules });
}

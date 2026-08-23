import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { isOwner } from "@/lib/owner";
import { addAiRule, listAiRules, removeAiRule, type AiRuleLabel } from "@/lib/db/aiRules";

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
  return NextResponse.json(result);
}

export async function DELETE(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isOwner(user.id)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const rules = await removeAiRule(id);
  return NextResponse.json({ rules });
}

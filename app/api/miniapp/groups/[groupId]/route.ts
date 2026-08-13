import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, updateGroupSettings } from "@/lib/db/groups";
import { getBotPermissions, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { isProActive } from "@/lib/billing/plan";
import type { GroupSettings } from "@/lib/db/types";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: rawGroupId } = await params;
  const chatId = Number(rawGroupId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
  }

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const botPermissions = await getBotPermissions(getApi(), chatId);
  const permCtx = {
    action: settings.action,
    captchaEnabled: settings.captchaEnabled,
    antiraidEnabled: settings.antiraidEnabled || settings.antiraidAuto,
    federationEnabled: settings.federationEnabled,
  };
  const missingPermissions = missingPermissionsFor(permCtx, botPermissions);

  return NextResponse.json({
    settings,
    missingPermissions,
    memberCount: null,
    proFeaturesEligible: true,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId: rawGroupId } = await params;
  const chatId = Number(rawGroupId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
  }

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const patch = (await req.json().catch(() => ({}))) as Partial<GroupSettings>;

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rejected: string[] = [];
  const gateKeys = ["captchaEnabled", "antiraidEnabled", "federationEnabled"] as const;
  if (!isProActive(settings)) {
    for (const key of gateKeys) {
      if (patch[key] === true) rejected.push(key);
    }
  }

  const updated = await updateGroupSettings(chatId, patch);
  return NextResponse.json({ settings: updated, rejected });
}

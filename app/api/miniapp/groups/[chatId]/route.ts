import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, updateGroupSettings } from "@/lib/db/groups";
import { getBotPermissions, isChatAdmin, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { isProActive } from "@/lib/billing/plan";
import type { GroupSettings } from "@/lib/db/types";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId: rawChatId } = await params;
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const chatId = Number(rawChatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
  }

  const api = getApi();
  const isAdmin = await isChatAdmin(api, chatId, user.id).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const botPermissions = await getBotPermissions(api, chatId);
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
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId: rawChatId } = await params;
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const chatId = Number(rawChatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
  }

  const api = getApi();
  const isAdmin = await isChatAdmin(api, chatId, user.id).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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

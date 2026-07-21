import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getGroupSettings, getWhitelist, updateGroupSettings } from "@/lib/db/groups";
import { getApi } from "@/lib/telegram/api";
import { getBotPermissions, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { canUseProFeature } from "@/lib/billing/plan";
import { isLang } from "@/lib/i18n";
import type { GroupSettings, ViolationAction } from "@/lib/db/types";

export const runtime = "nodejs";

const VALID_ACTIONS: ViolationAction[] = ["delete", "warn", "mute", "ban"];

function parseChatId(groupId: string): number | null {
  const id = Number(groupId);
  return Number.isFinite(id) ? id : null;
}

async function buildStatusFields(chatId: number, settings: GroupSettings) {
  const api = getApi();
  const [botPermissions, memberCount] = await Promise.all([
    getBotPermissions(api, chatId),
    getCachedMemberCount(api, chatId),
  ]);
  const missingPermissions = missingPermissionsFor(
    { action: settings.action, captchaEnabled: settings.captchaEnabled, antiraidEnabled: settings.antiraidEnabled },
    botPermissions
  );
  return {
    botPermissions,
    missingPermissions,
    memberCount,
    proFeaturesEligible: canUseProFeature(settings, memberCount),
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const [settings, whitelist] = await Promise.all([getGroupSettings(chatId), getWhitelist(chatId)]);
  if (!settings) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await buildStatusFields(chatId, settings);
  return NextResponse.json({ settings, whitelist, ...status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const chatId = parseChatId(groupId);
  if (chatId === null) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const auth = await authorizeGroupAdmin(req, chatId);
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const current = await getGroupSettings(chatId);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.profanityFilter === "boolean") patch.profanityFilter = body.profanityFilter;
  if (typeof body.antispam === "boolean") patch.antispam = body.antispam;
  if (typeof body.premium === "boolean") patch.premium = body.premium;
  if (typeof body.action === "string" && VALID_ACTIONS.includes(body.action as ViolationAction)) {
    patch.action = body.action;
  }
  if (isLang(body.lang)) patch.lang = body.lang;
  if (body.logChannelId === null || typeof body.logChannelId === "number") {
    patch.logChannelId = body.logChannelId;
  }
  if (typeof body.welcomeEnabled === "boolean") patch.welcomeEnabled = body.welcomeEnabled;
  if (body.welcomeMessage === null || typeof body.welcomeMessage === "string") {
    patch.welcomeMessage = body.welcomeMessage;
  }

  // Turning captcha/antiraid OFF is always allowed; turning ON requires Pro eligibility.
  if (typeof body.captchaEnabled === "boolean") {
    if (!body.captchaEnabled) {
      patch.captchaEnabled = false;
    } else {
      const memberCount = await getCachedMemberCount(getApi(), chatId);
      if (!canUseProFeature(current, memberCount)) {
        return NextResponse.json({ error: "pro required" }, { status: 402 });
      }
      patch.captchaEnabled = true;
    }
  }
  if (typeof body.antiraidEnabled === "boolean") {
    if (!body.antiraidEnabled) {
      patch.antiraidEnabled = false;
    } else {
      const memberCount = await getCachedMemberCount(getApi(), chatId);
      if (!canUseProFeature(current, memberCount)) {
        return NextResponse.json({ error: "pro required" }, { status: 402 });
      }
      patch.antiraidEnabled = true;
    }
  }

  const updated = await updateGroupSettings(chatId, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await buildStatusFields(chatId, updated);
  return NextResponse.json({ settings: updated, ...status });
}

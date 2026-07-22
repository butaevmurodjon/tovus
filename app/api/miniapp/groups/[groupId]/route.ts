import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getGroupSettings, updateGroupSettings } from "@/lib/db/groups";
import { getApi } from "@/lib/telegram/api";
import { getBotPermissions, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { normalizeWelcomeMessage } from "@/lib/telegram/welcome";
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

  const settings = await getGroupSettings(chatId);
  if (!settings) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await buildStatusFields(chatId, settings);
  return NextResponse.json({ settings, ...status });
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
    patch.welcomeMessage = body.welcomeMessage === null ? null : normalizeWelcomeMessage(body.welcomeMessage);
  }

  // Turning captcha/antiraid OFF is always allowed; turning ON requires Pro eligibility.
  // Member count is fetched at most once even if both are toggled on in the same request.
  const togglingOnProFeature =
    (typeof body.captchaEnabled === "boolean" && body.captchaEnabled) ||
    (typeof body.antiraidEnabled === "boolean" && body.antiraidEnabled);
  const eligible = togglingOnProFeature
    ? canUseProFeature(current, await getCachedMemberCount(getApi(), chatId))
    : true;

  // A gated toggle that fails eligibility is rejected individually, not the whole
  // request — otherwise a mixed patch (e.g. a new welcome message alongside an
  // ineligible captcha toggle) would silently drop the welcome-message change too.
  const rejected: string[] = [];
  if (typeof body.captchaEnabled === "boolean") {
    if (!body.captchaEnabled || eligible) {
      patch.captchaEnabled = body.captchaEnabled;
    } else {
      rejected.push("captchaEnabled");
    }
  }
  if (typeof body.antiraidEnabled === "boolean") {
    if (!body.antiraidEnabled || eligible) {
      patch.antiraidEnabled = body.antiraidEnabled;
    } else {
      rejected.push("antiraidEnabled");
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "pro required", rejected }, { status: 402 });
  }

  const updated = await updateGroupSettings(chatId, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });

  const status = await buildStatusFields(chatId, updated);
  return NextResponse.json({ settings: updated, rejected, ...status });
}

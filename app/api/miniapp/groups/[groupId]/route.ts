import { NextResponse } from "next/server";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, getWhitelist, updateGroupSettings } from "@/lib/db/groups";
import { getBotPermissions, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { getStats } from "@/lib/db/stats";
import { canUseProFeature } from "@/lib/billing/plan";
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

  // whitelist/today's-stats are for the §6.5 priority-5 overview card — cheap
  // enough (one smembers, one hgetall) to fetch unconditionally alongside the
  // rest rather than adding a second round trip just for that card.
  const [botPermissions, memberCount, whitelist, todayStats] = await Promise.all([
    getBotPermissions(getApi(), chatId),
    getCachedMemberCount(getApi(), chatId),
    getWhitelist(chatId),
    getStats(chatId, "today"),
  ]);
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
    memberCount,
    // Captcha/antiraid are unconditionally free now (Phase 1 re-cut) — this
    // only gates federation (the remaining size-limited Pro feature the group
    // settings page shows a lock on).
    federationEligible: canUseProFeature(settings, memberCount),
    whitelistCount: whitelist.length,
    violationsToday: todayStats.total,
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

  // Same eligibility rule `requireProFeature` gates on in commands.ts: active
  // Pro OR small enough for the free-tier grace. Only `federationEnabled` is
  // still gated here — captcha/antiraid are unconditionally free (Phase 1
  // re-cut) and never rejected.
  const memberCount = await getCachedMemberCount(getApi(), chatId);
  const eligible = canUseProFeature(settings, memberCount);

  const rejected: string[] = [];
  const gateKeys = ["federationEnabled"] as const;
  if (!eligible) {
    for (const key of gateKeys) {
      if (patch[key] !== true) continue;
      rejected.push(key);
    }
  }

  // Strip the rejected keys so an ineligible group can't persist a Pro toggle
  // through the Mini App — the chat commands already prevent this by gating
  // before `updateGroupSettings`. Matters for `federationEnabled`: federation.ts
  // trusts the stored flag and never re-checks size eligibility, so a
  // persisted `true` would be a real entitlement bypass.
  const effectivePatch = { ...patch };
  for (const key of rejected) delete effectivePatch[key as keyof GroupSettings];

  const updated = await updateGroupSettings(chatId, effectivePatch);
  return NextResponse.json({
    settings: updated,
    rejected,
    memberCount,
    federationEligible: canUseProFeature(updated ?? settings, memberCount),
  });
}

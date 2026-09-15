import { NextResponse } from "next/server";
import { GrammyError } from "grammy";
import { authorizeGroupAdmin } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getGroupSettings, getWhitelist, updateGroupSettings } from "@/lib/db/groups";
import { getBotPermissions, isBotAdminOfChat, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { getStats } from "@/lib/db/stats";
import { getCustomWords } from "@/lib/db/customWords";
import { getAllowlist } from "@/lib/db/allowlist";
import { canUseProFeature } from "@/lib/billing/plan";
import { supportUrl } from "@/lib/telegram/support";
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
  // customWords/allowlist counts are for the settings index's "Списки и
  // слова" status subtitle (PR-1) — same cheap-enough-to-always-fetch logic
  // as whitelist above; both lists are capped (200 words / 100 entries, see
  // the add-routes) so this never grows unbounded.
  const [botPermissions, memberCount, whitelist, todayStats, customWords, allowlist] = await Promise.all([
    getBotPermissions(getApi(), chatId),
    getCachedMemberCount(getApi(), chatId),
    getWhitelist(chatId),
    getStats(chatId, "today"),
    getCustomWords(chatId),
    getAllowlist(chatId),
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
    customWordsCount: customWords.length,
    allowlistCount: allowlist.length,
    violationsToday: todayStats.total,
    // Null when TELEGRAM_BOT_USERNAME isn't provisioned — the page must then
    // simply omit the "Написать в поддержку" button, same convention as
    // addToGroupUrl()/appealUrl() elsewhere.
    supportUrl: supportUrl(chatId),
    // Both toggles below are real no-ops without their env var (silent
    // early-return in the code that would otherwise act on them) — surfaced
    // here so the settings page can disable+explain instead of showing a
    // "these do something" state that never fires.
    ocrConfigured: Boolean(process.env.OCR_API_KEY),
    digestHubConfigured: Boolean(process.env.DIGEST_HUB_CHAT_ID),
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

  // ownerChannelId is never trusted straight from the client — same reason
  // /setchannel in the bot resolves+validates server-side instead of taking
  // an id directly: an arbitrary client-supplied id would let a group gate
  // (or silently un-gate, by pointing at a channel the bot IS admin of but
  // has nothing to do with this group) on any channel at all. Only
  // `ownerChannelUsername` is accepted from the client; the id is always
  // (re)resolved here.
  // Owner-only field (see GroupSettings.dailySummaryOwnerAllowed doc
  // comment) — a group admin's own PATCH call must never be able to grant
  // itself this, only /api/miniapp/owner/groups/[groupId]/dailysummary can.
  if ("dailySummaryOwnerAllowed" in patch) delete patch.dailySummaryOwnerAllowed;
  if ("lastDailySummarySentDate" in patch) delete patch.lastDailySummarySentDate;

  // Owner-only / server-managed fields. Without this an admin PATCH could
  // self-grant PRO (`plan`/`planExpiresAt` — see /owner/groups/[id]/pro for
  // the only legitimate writer), forge referral attribution, or rewrite
  // bookkeeping (`lastDigestSentMonth`, `createdAt`, `chatId`) the group has
  // no business touching. `title` is synced from Telegram itself on every
  // my_chat_member event (registerGroup) — never client-writable.
  const ownerOnlyFields = [
    "plan",
    "planExpiresAt",
    "referredBy",
    "lastDigestSentMonth",
    "createdAt",
    "chatId",
    "title",
  ] as const;
  for (const key of ownerOnlyFields) {
    if (key in patch) delete patch[key];
  }

  let channelGateError: string | null = null;
  if ("ownerChannelId" in patch) delete patch.ownerChannelId;
  if ("ownerChannelUsername" in patch) {
    const username = patch.ownerChannelUsername;
    delete patch.ownerChannelUsername;
    if (!username) {
      patch.ownerChannelId = null;
      patch.ownerChannelUsername = null;
      patch.ownerChannelGateEnabled = false;
    } else {
      try {
        const handle = username.startsWith("@") ? username : `@${username}`;
        const chat = await getApi().getChat(handle);
        if (chat.type !== "channel" || !(await isBotAdminOfChat(getApi(), chat.id))) {
          channelGateError = "channel_not_admin";
        } else {
          patch.ownerChannelId = chat.id;
          patch.ownerChannelUsername = "username" in chat ? (chat.username ?? null) : null;
        }
      } catch (err) {
        if (err instanceof GrammyError) channelGateError = "channel_not_found";
        else throw err;
      }
    }
  }

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
  // Same "rejected" convention as the Pro gate keys above — the failed
  // channel resolve/admin-check from the block above surfaces the same way
  // the (currently unused elsewhere) logChannelId convention already expects.
  if (channelGateError) rejected.push("ownerChannelUsername");

  // Strip the rejected keys so an ineligible group can't persist a Pro toggle
  // through the Mini App — the chat commands already prevent this by gating
  // before `updateGroupSettings`. Matters for `federationEnabled`: federation.ts
  // trusts the stored flag and never re-checks size eligibility, so a
  // persisted `true` would be a real entitlement bypass. `ownerChannelId`/
  // `ownerChannelGateEnabled` are stripped the same way when the channel
  // resolve above failed, so a rejected channel can't half-apply.
  const effectivePatch = { ...patch };
  for (const key of rejected) delete effectivePatch[key as keyof GroupSettings];
  if (channelGateError) {
    delete effectivePatch.ownerChannelId;
    delete effectivePatch.ownerChannelGateEnabled;
  }

  const updated = await updateGroupSettings(chatId, effectivePatch);
  return NextResponse.json({
    settings: updated,
    rejected,
    memberCount,
    federationEligible: canUseProFeature(updated ?? settings, memberCount),
  });
}

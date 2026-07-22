import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getBotPermissions, isChatAdmin, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { getGroupSettings } from "@/lib/db/groups";
import { getUserAdminGroupIds } from "@/lib/db/admins";
import { isProActive } from "@/lib/billing/plan";
import type { AdminGroupSummary } from "@/lib/db/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const api = getApi();
  // Reverse index instead of scanning every group the bot has ever joined —
  // this used to be O(all groups the bot is in), doing a live getChatMember
  // call per group for every dashboard load regardless of who was asking.
  // The live isChatAdmin check below stays as defense-in-depth in case the
  // index is stale (a missed chat_member update): it can only ever narrow
  // results, never grant access the index didn't already suggest.
  const chatIds = await getUserAdminGroupIds(user.id);

  const results = await Promise.all(
    chatIds.map(async (chatId): Promise<AdminGroupSummary | null> => {
      const admin = await isChatAdmin(api, chatId, user.id).catch(() => false);
      if (!admin) return null;
      const [settings, botPermissions] = await Promise.all([getGroupSettings(chatId), getBotPermissions(api, chatId)]);
      if (!settings) return null;
      const permCtx = {
        action: settings.action,
        captchaEnabled: settings.captchaEnabled,
        // antiraidAuto defaults true — a group can be silently protected (and
        // need restrict rights) even with the visible toggle off.
        antiraidEnabled: settings.antiraidEnabled || settings.antiraidAuto,
        federationEnabled: settings.federationEnabled,
      };
      return {
        chatId,
        title: settings.title,
        premium: settings.premium,
        profanityFilter: settings.profanityFilter,
        antispam: settings.antispam,
        hasPermissionIssue: missingPermissionsFor(permCtx, botPermissions).length > 0,
        plan: settings.plan,
        isPro: isProActive(settings),
      };
    })
  );

  return NextResponse.json({ groups: results.filter((g): g is AdminGroupSummary => g !== null) });
}

import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/telegram/miniAppAuth";
import { getApi } from "@/lib/telegram/api";
import { getBotPermissions, isChatAdmin, missingPermissionsFor } from "@/lib/telegram/adminCheck";
import { getGroupSettings, listAllGroupIds } from "@/lib/db/groups";
import type { AdminGroupSummary } from "@/lib/db/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const api = getApi();
  const chatIds = await listAllGroupIds();

  const results = await Promise.all(
    chatIds.map(async (chatId): Promise<AdminGroupSummary | null> => {
      const admin = await isChatAdmin(api, chatId, user.id).catch(() => false);
      if (!admin) return null;
      const settings = await getGroupSettings(chatId);
      if (!settings) return null;
      const botPermissions = await getBotPermissions(api, chatId);
      return {
        chatId,
        title: settings.title,
        premium: settings.premium,
        profanityFilter: settings.profanityFilter,
        antispam: settings.antispam,
        hasPermissionIssue:
          missingPermissionsFor({ action: settings.action, captchaEnabled: settings.captchaEnabled }, botPermissions)
            .length > 0,
      };
    })
  );

  return NextResponse.json({ groups: results.filter((g): g is AdminGroupSummary => g !== null) });
}

import type { Api } from "grammy";
import type { User } from "grammy/types";
import { getGroupAdminIds, getUserAdminGroupIds } from "@/lib/db/admins";
import { getGroupSettings } from "@/lib/db/groups";
import { t } from "@/lib/i18n";
import { displayName } from "./format";

/**
 * Which OTHER chats a ban in `sourceChatId` could spread to: every group any
 * of `sourceChatId`'s current admins also administers, excluding the source
 * itself. Pure/testable — the actual "is federation on" filtering happens
 * per-candidate in propagateBan, since that needs a DB read per group.
 */
export function computeFederationCandidates(sourceChatId: number, adminGroupSets: number[][]): number[] {
  const candidates = new Set<number>();
  for (const groups of adminGroupSets) {
    for (const chatId of groups) {
      if (chatId !== sourceChatId) candidates.add(chatId);
    }
  }
  return [...candidates];
}

/**
 * Propagates a ban to every other group sharing an admin with `sourceChatId`
 * that has also opted into federation. Trust boundary is shared admin
 * identity: this can only ever reach a group where someone who administers
 * the source group right now also administers the target — never a group
 * with no admin in common, regardless of how many groups across the whole
 * bot have federation turned on.
 */
export async function propagateBan(api: Api, sourceChatId: number, user: User, reason: string): Promise<void> {
  const adminIds = await getGroupAdminIds(sourceChatId);
  if (adminIds.length === 0) return;

  const adminGroupSets = await Promise.all(adminIds.map((id) => getUserAdminGroupIds(id)));
  const candidates = computeFederationCandidates(sourceChatId, adminGroupSets);
  if (candidates.length === 0) return;

  await Promise.all(
    candidates.map(async (targetChatId) => {
      const targetSettings = await getGroupSettings(targetChatId);
      if (!targetSettings?.federationEnabled) return;
      const banned = await api.banChatMember(targetChatId, user.id).catch(() => null);
      if (!banned) return; // permission/network failure — nothing actually happened, no notice to send
      await api
        .sendMessage(targetChatId, t(targetSettings.lang, "bot.federatedBan", { user: displayName(user), reason }))
        .catch(() => {});
    })
  );
}

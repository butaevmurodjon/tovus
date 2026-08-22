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
 * Same trust boundary as propagateBan (shared-admin-identity, federationEnabled
 * opt-in on the target), but exposed standalone for M4's cross-group broadcast
 * (§15.5) — that needs the target chat IDs themselves, not a side effect on
 * each one. Kept separate from propagateBan rather than having it call this,
 * so the ban path (already in production) isn't touched by this addition.
 */
export async function getFederationTargetChatIds(sourceChatId: number): Promise<number[]> {
  const adminIds = await getGroupAdminIds(sourceChatId);
  if (adminIds.length === 0) return [];

  const adminGroupSets = await Promise.all(adminIds.map((id) => getUserAdminGroupIds(id)));
  const candidates = computeFederationCandidates(sourceChatId, adminGroupSets);
  if (candidates.length === 0) return [];

  const candidateSettings = await Promise.all(candidates.map((id) => getGroupSettings(id)));
  return candidates.filter((_, i) => candidateSettings[i]?.federationEnabled === true);
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

  // allSettled, not all: getGroupSettings can throw (a Redis/network error is
  // not caught internally), and a plain Promise.all would let one candidate's
  // failure reject the whole batch, silently skipping ban propagation to
  // every OTHER candidate that would otherwise have succeeded.
  await Promise.allSettled(
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

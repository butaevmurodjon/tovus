import type { Api } from "grammy";
import { listAllGroupIds } from "@/lib/db/groups";
import { addGlobalBanEntry, removeGlobalBanEntry } from "@/lib/db/globalBan";
import type { GlobalBanEntry } from "@/lib/db/types";
import { deleteLastMessage } from "./messageCleanup";

/**
 * Bans a user in every group the bot currently manages and records the ban so
 * future joins are blocked too (see the new_chat_members check in bot.ts).
 * Best-effort per group — the bot lacking restrict rights in one group (or
 * the user already being gone from it) must not stop the ban from landing in
 * every other group it does have rights in.
 */
export async function banUserEverywhere(
  api: Api,
  userId: number,
  reason: string,
  bannedBy: number
): Promise<{ entry: GlobalBanEntry; bannedGroups: number; totalGroups: number }> {
  const entry: GlobalBanEntry = { userId, reason, bannedAt: Date.now(), bannedBy };
  await addGlobalBanEntry(entry);

  const chatIds = await listAllGroupIds();
  const results = await Promise.all(
    chatIds.map((chatId) =>
      api
        .banChatMember(chatId, userId)
        .then(async () => {
          // Best-effort, never blocks the ban result on a delete failing.
          await deleteLastMessage(api, chatId, userId);
          return true;
        })
        .catch(() => false)
    )
  );
  return { entry, bannedGroups: results.filter(Boolean).length, totalGroups: chatIds.length };
}

export async function unbanUserEverywhere(
  api: Api,
  userId: number
): Promise<{ unbannedGroups: number; totalGroups: number }> {
  await removeGlobalBanEntry(userId);

  const chatIds = await listAllGroupIds();
  const results = await Promise.all(
    chatIds.map((chatId) =>
      api
        .unbanChatMember(chatId, userId, { only_if_banned: true })
        .then(() => true)
        .catch(() => false)
    )
  );
  return { unbannedGroups: results.filter(Boolean).length, totalGroups: chatIds.length };
}

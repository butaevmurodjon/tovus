import type { Api } from "grammy";
import { clearLastMessage, getLastMessageId } from "@/lib/db/messageAuthors";

/**
 * Best-effort: deletes the user's most recently seen message in this chat, if
 * one is cached (see lib/db/messageAuthors.ts). An automatic moderation ban
 * already deletes the specific message that triggered it (violations.ts) — this
 * covers manual bans (per-group panel, the link/username tool, global ban),
 * which act on a userId with no single flagged message behind them, so nothing
 * would otherwise get cleaned up in the group where the ban happened.
 */
export async function deleteLastMessage(api: Api, chatId: number, userId: number): Promise<void> {
  try {
    const messageId = await getLastMessageId(chatId, userId);
    if (!messageId) return;
    await api.deleteMessage(chatId, messageId).catch(() => {});
    await clearLastMessage(chatId, userId).catch(() => {});
  } catch {
    // A Redis blip here must never look like the ban itself failed —
    // callers (globalBan.ts especially) treat this as fully best-effort.
  }
}

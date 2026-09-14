import { incrWithTtl } from "@/lib/db/redis";
import { REACTION_FLOOD_MAX, REACTION_FLOOD_WINDOW_SECONDS } from "./spamDict";

/**
 * ROADMAP.md §7.3 — "Спам реакциями" (@LolsBot): an account rapid-firing
 * reactions across many messages to draw attention to its profile. Same
 * counter-per-window shape as flood.ts's checkUserFlood, just keyed on
 * reaction events (message_reaction updates) instead of messages.
 */
const reactionFloodKey = (chatId: number, userId: number) => `reactionflood:${chatId}:${userId}`;

export async function checkReactionFlood(chatId: number, userId: number): Promise<boolean> {
  const count = await incrWithTtl(reactionFloodKey(chatId, userId), REACTION_FLOOD_WINDOW_SECONDS);
  return count > REACTION_FLOOD_MAX;
}

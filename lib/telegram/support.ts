import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { isOwner } from "@/lib/owner";
import { addSupportTicket, findSupportTicketByOwnerMessage, setSupportTicketStatus } from "@/lib/db/supportTickets";
import type { SupportTicket } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";

/**
 * "Написать разработчику" — a GROUP ADMIN reaching the BOT OWNER, entered
 * from the Mini App, conversation relayed through the bot itself (chosen
 * over a Mini App inbox because only the bot can push a notification to
 * either side — see the conversation this shipped from). Mirrors
 * appealUrl/parseAppealPayload in commands.ts (`?start=support_<groupId>`
 * instead of `appeal_<chatId>`), kept in its own module rather than folded
 * into commands.ts's appeal helpers since the two flows have different
 * audiences (group member → group admin vs. group admin → bot owner) and
 * different persistence (appeals.ts's TTL'd cooldown+per-group list vs.
 * supportTickets.ts's durable, bot-wide, reply-routable list).
 */

export function supportUrl(groupId: number): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=support_${groupId}`;
}

/** `support_<groupId>` from a `?start=` payload — groupId is a Telegram
 * group id, always negative for supergroups, so the digits need a leading
 * `-`. Same shape as parseAppealPayload. */
export function parseSupportPayload(payload: string | undefined | null): number | null {
  if (!payload) return null;
  const match = /^support_(-?\d{1,15})$/.exec(payload.trim());
  if (!match) return null;
  const groupId = Number(match[1]);
  return Number.isSafeInteger(groupId) ? groupId : null;
}

export interface SendTicketInput {
  groupId: number;
  groupTitle: string;
  fromUserId: number;
  fromUsername: string | null;
  fromDisplayName: string;
  text: string;
}

/** Relays a new ticket to BOT_OWNER_ID and persists it so a reply — even
 * days later — can be routed back. Returns null if delivery to the owner
 * itself failed (owner blocked the bot, etc.) — the caller should tell the
 * sender their message could not be delivered rather than claiming success. */
export async function sendSupportTicketToOwner(api: Api, ownerUserId: number, input: SendTicketInput): Promise<SupportTicket | null> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const header =
    `🆘 Обращение от владельца группы\n` +
    `Группа: ${input.groupTitle} (id${input.groupId})\n` +
    `От: ${input.fromDisplayName}${input.fromUsername ? ` (@${input.fromUsername})` : ""} (id${input.fromUserId})\n\n` +
    input.text;

  let sent;
  try {
    sent = await api.sendMessage(ownerUserId, header);
  } catch (err) {
    if (err instanceof GrammyError) return null;
    throw err;
  }

  const ticket: SupportTicket = {
    id,
    groupId: input.groupId,
    groupTitle: input.groupTitle,
    fromUserId: input.fromUserId,
    fromUsername: input.fromUsername,
    fromDisplayName: input.fromDisplayName,
    text: input.text,
    createdAt: Date.now(),
    status: "open",
    ownerChatId: sent.chat.id,
    ownerMessageId: sent.message_id,
  };
  await addSupportTicket(ticket);
  return ticket;
}

export type RelayReplyResult = "not-a-reply" | "no-ticket" | "delivered" | "delivery-failed";

/**
 * Called on every private text message the BOT OWNER sends the bot — routes
 * it back to the original ticket sender if (and only if) it's a Telegram
 * "Reply" on a message this module previously sent them for a ticket. Any
 * other private message from the owner (a command, ordinary chat) is left
 * alone: "not-a-reply" / "no-ticket" are not errors, just "this wasn't that".
 */
export async function relayOwnerReply(
  api: Api,
  ownerUserId: number,
  replyToMessageId: number | undefined,
  replyChatId: number,
  text: string,
  lang: Lang
): Promise<RelayReplyResult> {
  if (!isOwner(ownerUserId)) return "not-a-reply";
  if (replyToMessageId === undefined) return "not-a-reply";

  const ticket = await findSupportTicketByOwnerMessage(replyChatId, replyToMessageId);
  if (!ticket) return "no-ticket";

  try {
    await api.sendMessage(ticket.fromUserId, t(lang, "bot.supportReplyPrefix", { title: ticket.groupTitle }) + "\n\n" + text);
  } catch (err) {
    if (err instanceof GrammyError) return "delivery-failed";
    throw err;
  }

  await setSupportTicketStatus(ticket.id, "replied");
  return "delivered";
}

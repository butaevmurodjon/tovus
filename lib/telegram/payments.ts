import type { Api } from "grammy";
import { updateGroupSettings } from "@/lib/db/groups";
import {
  MAX_UNBAN_PRICE_STARS,
  MIN_UNBAN_PRICE_STARS,
  PRO_PRICE_STARS,
  PRO_SUBSCRIPTION_PERIOD_SECONDS,
} from "@/lib/billing/plan";
import { t, type Lang } from "@/lib/i18n";

// Re-exported so existing importers of this file (the appeals API route)
// don't need a second import from lib/billing/plan just for these two.
export { MAX_UNBAN_PRICE_STARS, MIN_UNBAN_PRICE_STARS };

const PAYLOAD_PREFIX = "pro:";

const UNBAN_PAYLOAD_PREFIX = "unban:";

function buildPayload(chatId: number): string {
  return `${PAYLOAD_PREFIX}${chatId}`;
}

/** Returns the chatId the payment was for, or null if this payload isn't one of ours. */
export function parseProPayload(payload: string): number | null {
  if (!payload.startsWith(PAYLOAD_PREFIX)) return null;
  const idPart = payload.slice(PAYLOAD_PREFIX.length);
  if (idPart === "") return null;
  const chatId = Number(idPart);
  return Number.isFinite(chatId) ? chatId : null;
}

/**
 * `subscription_period` (recurring Stars billing) is only accepted by
 * createInvoiceLink — sendInvoice has no such parameter, so a one-off invoice
 * message would silently be a single charge, not a subscription. Both the chat
 * command and the Mini App route through this same link for that reason.
 */
export async function createUpgradeInvoiceLink(api: Api, chatId: number, lang: Lang): Promise<string> {
  return api.createInvoiceLink(
    t(lang, "bot.proInvoiceTitle"),
    t(lang, "bot.proInvoiceDescription"),
    buildPayload(chatId),
    "", // provider_token: empty string = Telegram Stars
    "XTR",
    [{ label: t(lang, "bot.proInvoiceLabel"), amount: PRO_PRICE_STARS }],
    { subscription_period: PRO_SUBSCRIPTION_PERIOD_SECONDS }
  );
}

/** Posts the invoice link in-chat as a Pay button (chat commands can't call openInvoice like the Mini App can). */
export async function sendUpgradeInvoice(api: Api, chatId: number, lang: Lang): Promise<void> {
  const link = await createUpgradeInvoiceLink(api, chatId, lang);
  await api.sendMessage(chatId, t(lang, "bot.proInvoicePrompt"), {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "bot.proInvoiceButton"), url: link }]] },
  });
}

/**
 * Called on a successful_payment update — activates (or extends) the Pro plan
 * for the group. Returns whether the group actually exists/was updated, so the
 * caller can avoid telling a payer Pro is active when it silently wasn't.
 */
export async function activateProPlan(chatId: number, expiresAtMs: number): Promise<boolean> {
  const result = await updateGroupSettings(chatId, { plan: "pro", planExpiresAt: expiresAtMs });
  return result !== null;
}

// --- paid unban (2026-09-12 "написать администратору" follow-up) ---------
//
// Money here goes straight to the BOT'S OWN Stars/Fragment balance, same as
// the PRO invoice above — createInvoiceLink has no concept of "pay this group's
// admin", only "pay this bot". The Mini App copy MUST say so explicitly before
// an admin sets a price (see appeals/[appealId]/route.ts) — the alternative is
// an admin discovering later that a payment they set up didn't reach them.

/** `appealId` is opaque (matches lib/db/appeals.ts's generated ids), so no
 * length/charset assumption beyond "no colon" — the payload format itself
 * only needs it as the last, unambiguous segment. */
function buildUnbanPayload(chatId: number, userId: number, appealId: string): string {
  return `${UNBAN_PAYLOAD_PREFIX}${chatId}:${userId}:${appealId}`;
}

export interface UnbanPayload {
  chatId: number;
  userId: number;
  appealId: string;
}

/** Returns the appeal this payment resolves, or null if this payload isn't one of ours. */
export function parseUnbanPayload(payload: string): UnbanPayload | null {
  if (!payload.startsWith(UNBAN_PAYLOAD_PREFIX)) return null;
  const rest = payload.slice(UNBAN_PAYLOAD_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  const [chatIdPart, userIdPart, appealId] = parts;
  const chatId = Number(chatIdPart);
  const userId = Number(userIdPart);
  // isSafeInteger, not isFinite — matches parseRefPayload/parseAppealPayload
  // in commands.ts: these ids feed straight into unbanChatMember, so "1e2"
  // or "1.5" must never sneak through as a Telegram id.
  if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(userId) || !appealId) return null;
  return { chatId, userId, appealId };
}

/**
 * One-time invoice (no `subscription_period` — this is a single unban, not a
 * recurring charge) for the exact price an admin set on this specific appeal.
 * `amountStars` is trusted here — the caller (the appeals PATCH route) is
 * responsible for clamping it to [MIN_UNBAN_PRICE_STARS, MAX_UNBAN_PRICE_STARS].
 */
export async function createUnbanInvoiceLink(
  api: Api,
  chatId: number,
  userId: number,
  appealId: string,
  amountStars: number,
  groupTitle: string,
  lang: Lang
): Promise<string> {
  return api.createInvoiceLink(
    t(lang, "bot.unbanInvoiceTitle"),
    t(lang, "bot.unbanInvoiceDescription", { title: groupTitle }),
    buildUnbanPayload(chatId, userId, appealId),
    "",
    "XTR",
    [{ label: t(lang, "bot.unbanInvoiceLabel"), amount: amountStars }]
  );
}

/** Posts the invoice link in the appellant's private chat as a Pay button —
 * mirrors sendUpgradeInvoice above, same reasoning (sendMessage, not
 * sendInvoice, so the button can carry our own prompt text). */
export async function sendUnbanInvoice(
  api: Api,
  chatId: number,
  userId: number,
  appealId: string,
  amountStars: number,
  groupTitle: string,
  lang: Lang
): Promise<void> {
  const link = await createUnbanInvoiceLink(api, chatId, userId, appealId, amountStars, groupTitle, lang);
  await api.sendMessage(userId, t(lang, "bot.unbanInvoicePrompt", { title: groupTitle, amount: amountStars }), {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "bot.unbanInvoiceButton"), url: link }]] },
  });
}

import type { Api } from "grammy";
import { updateGroupSettings } from "@/lib/db/groups";
import { PRO_PRICE_STARS, PRO_SUBSCRIPTION_PERIOD_SECONDS } from "@/lib/billing/plan";
import { t, type Lang } from "@/lib/i18n";

const PAYLOAD_PREFIX = "pro:";

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

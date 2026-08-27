import type { Message } from "grammy/types";
import { DOMAIN_BLACKLIST, LINK_COUNT_THRESHOLD, MENTION_COUNT_THRESHOLD, QUOTE_AD_MARKERS, SCAM_PATTERNS } from "./spamDict";
import {
  containsCta,
  countMentions,
  extractLinks,
  extractQuote,
  findCloakedBotLink,
  findDangerousFileTag,
  findMaskedLinkHost,
  hostnameOf,
} from "./textSignals";

export interface SpamResult {
  matched: boolean;
  reason?: string;
  /** high = clear bot/scam pattern (blacklisted domain, invite link, forward+CTA). low = weaker signal (raw link count, mass mentions) — first-time members get a warning instead of the configured action for "low". */
  severity?: "low" | "high";
}

/**
 * Base (non-LLM) spam heuristics: link volume, blacklisted domains,
 * forwarded-channel-ad pattern, mass mentions.
 */
export function detectSpam(message: Message): SpamResult {
  const dangerousFile = findDangerousFileTag(message);
  if (dangerousFile) {
    const where = dangerousFile.fromQuotedMessage ? " в цитируемом сообщении" : "";
    return { matched: true, reason: `опасный тип файла${where}: ${dangerousFile.tag}`, severity: "high" };
  }

  // "Другой вид форварда": Telegram's Quote-reply feature carries an ad's
  // full pitch in message.quote (often relayed from another chat/channel via
  // external_reply) while the message's own text is an innocuous-sounding
  // recommendation ("Хороший впн, советую"). Checked before the text/entities
  // below are even read, since a quote can exist independent of them.
  const quote = extractQuote(message);
  if (quote) {
    const quoteLower = quote.text.toLowerCase();
    const quoteSource = quote.isExternal ? " из другого чата/канала" : "";

    const quoteScamPattern = SCAM_PATTERNS.find((phrase) => quoteLower.includes(phrase));
    if (quoteScamPattern) {
      return { matched: true, reason: `скам-схема в цитате${quoteSource}: ${quoteScamPattern}`, severity: "high" };
    }

    // quote.entities never carries text_link/url — Bot API's TextQuote only
    // preserves bold/italic/underline/strikethrough/spoiler/custom_emoji/
    // date_time — so findMaskedLinkHost/findCloakedBotLink can never fire
    // here; extractLinks still works via its plain-text regex fallback.
    const quoteLinks = extractLinks(quote.text, quote.entities);
    for (const link of quoteLinks) {
      const host = hostnameOf(link);
      if (host && DOMAIN_BLACKLIST.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        return { matched: true, reason: `запрещённый домен в цитате${quoteSource}: ${host}`, severity: "high" };
      }
      if (/^t\.me\/(joinchat|\+)/i.test(link.replace(/^https?:\/\//, ""))) {
        return { matched: true, reason: `ссылка-приглашение в цитате${quoteSource}`, severity: "high" };
      }
    }

    // Ad-hook phrases from the ad's OPENING line (QUOTE_AD_MARKERS), not just
    // its closing CTA (containsCta) — a quote can be truncated to a couple
    // dozen characters and still needs to trip this. Real sample: quote.text
    // starting "🔥 Бесплатный впн VanyaVPN...".
    const quotePromo = QUOTE_AD_MARKERS.find((phrase) => quoteLower.includes(phrase));
    if (quotePromo) {
      return { matched: true, reason: `реклама, замаскированная под цитату${quoteSource}: ${quotePromo}`, severity: "high" };
    }
    // A bare CTA phrase in the quote with no ad-hook marker is a weaker
    // signal, same tier as an own-text CTA alone: quoting a message to warn
    // about it or discuss it ("не ведитесь, это скам: 'хочешь заработать...'")
    // is exactly what the Quote-reply feature is designed for, so this can't
    // be high severity the way a matched QUOTE_AD_MARKERS hit or an
    // own-text CTA paired with a forward/link can.
    if (containsCta(quote.text)) {
      return { matched: true, reason: `цитата${quoteSource} содержит призыв к действию`, severity: "low" };
    }
  }

  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities;
  if (!text) return { matched: false };

  // Strong standalone scam-scheme phrases ("мошеннические схемы") — job-scam
  // pay-for-views, fake review writing, "write to the manager" DM-bait. Clear
  // enough to escalate at high severity with no link, forward, or mention: a
  // plain-text job scam gets deleted (deleteMessage runs unconditionally in
  // applyViolation) instead of slipping through because it had no URL. Kept as
  // specific multi-word phrases — bare terms like "ищем работников" or "ставка
  // за час" are legitimate job-ad vocabulary and must not trip this.
  const scamPattern = SCAM_PATTERNS.find((phrase) => text.toLowerCase().includes(phrase));
  if (scamPattern) {
    return { matched: true, reason: `скам-схема: ${scamPattern}`, severity: "high" };
  }

  const links = extractLinks(text, entities);

  const maskedHost = findMaskedLinkHost(text, entities);
  if (maskedHost) {
    return { matched: true, reason: `маскированная ссылка (ведёт на ${maskedHost})`, severity: "high" };
  }

  const cloakedBotLink = findCloakedBotLink(text, entities);
  if (cloakedBotLink) {
    return { matched: true, reason: `обычное слово замаскировано под ссылку на бота: ${cloakedBotLink}`, severity: "high" };
  }

  for (const link of links) {
    const host = hostnameOf(link);
    if (host && DOMAIN_BLACKLIST.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return { matched: true, reason: `запрещённый домен: ${host}`, severity: "high" };
    }
    if (/^t\.me\/(joinchat|\+)/i.test(link.replace(/^https?:\/\//, ""))) {
      return { matched: true, reason: "ссылка-приглашение в чужой канал/чат", severity: "high" };
    }
  }

  // Any forward origin (channel, chat, or a regular/hidden user) paired with a
  // CTA is DM-bait/ad-forward spam regardless of where it was forwarded from —
  // scammers relay through ordinary user accounts just as often as channels.
  const isForwarded = Boolean(message.forward_origin);
  if ((isForwarded || links.length > 0) && containsCta(text)) {
    return { matched: true, reason: "пересылка/ссылка с призывом к действию", severity: "high" };
  }

  if (links.length >= LINK_COUNT_THRESHOLD) {
    return { matched: true, reason: `${links.length} ссылок в сообщении`, severity: "low" };
  }

  const mentions = countMentions(entities);
  if (mentions >= MENTION_COUNT_THRESHOLD) {
    return { matched: true, reason: `массовые упоминания (${mentions})`, severity: "low" };
  }

  // A single @mention plus a CTA phrase ("пиши в лс", "хочешь заработать") is a
  // weaker signal than a link or a forward — genuine chat can coincidentally hit
  // this — so it's "low" severity rather than "high", same tier as raw link count.
  if (mentions > 0 && containsCta(text)) {
    return { matched: true, reason: "упоминание с призывом к действию", severity: "low" };
  }

  return { matched: false };
}

export function hasAnyLink(message: Message): boolean {
  const text = message.text ?? message.caption ?? "";
  if (!text) return false;
  return extractLinks(text, message.entities ?? message.caption_entities).length > 0;
}

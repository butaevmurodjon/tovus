import type { Message } from "grammy/types";
import { DOMAIN_BLACKLIST, LINK_COUNT_THRESHOLD, MENTION_COUNT_THRESHOLD, SCAM_PATTERNS } from "./spamDict";
import {
  containsCta,
  countMentions,
  extractLinks,
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
    return { matched: true, reason: `опасный тип файла: ${dangerousFile}`, severity: "high" };
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

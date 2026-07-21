import type { Message, MessageEntity } from "grammy/types";
import {
  CTA_PHRASES,
  DOMAIN_BLACKLIST,
  LINK_COUNT_THRESHOLD,
  MENTION_COUNT_THRESHOLD,
} from "./spamDict";

export interface SpamResult {
  matched: boolean;
  reason?: string;
  /** high = clear bot/scam pattern (blacklisted domain, invite link, forward+CTA). low = weaker signal (raw link count, mass mentions) — first-time members get a warning instead of the configured action for "low". */
  severity?: "low" | "high";
}

function extractLinks(text: string, entities: MessageEntity[] | undefined): string[] {
  const links: string[] = [];
  for (const entity of entities ?? []) {
    if (entity.type === "text_link" && entity.url) {
      links.push(entity.url);
    } else if (entity.type === "url") {
      links.push(text.slice(entity.offset, entity.offset + entity.length));
    }
  }
  // Telegram reliably parses URLs into entities — the regex scan is only a fallback for
  // the rare case entities are missing/empty. Running both unconditionally double-counts
  // every link (once from entities, once from the regex), which used to make a single
  // ordinary link look like 2 links and falsely trip the link-count spam rule.
  if (links.length === 0) {
    const urlRegex = /(https?:\/\/|t\.me\/|www\.)[^\s]+/gi;
    for (const match of text.matchAll(urlRegex)) {
      links.push(match[0]);
    }
  }
  return Array.from(new Set(links.map((l) => l.toLowerCase())));
}

function hostnameOf(link: string): string | null {
  try {
    const withProto = link.startsWith("http") ? link : `https://${link}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const VISIBLE_URL_PATTERN = /^(https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\/|$)/i;

/**
 * Telegram lets a hyperlink's visible text say one thing while the href points
 * somewhere else entirely — classic phishing move ("google.com" that actually
 * opens a scam domain). Flags it only when the visible text itself looks like
 * a URL/domain and disagrees with the real one; plain descriptive link text
 * ("нажми тут") is not suspicious on its own.
 */
function findMaskedLink(text: string, entities: MessageEntity[] | undefined): string | null {
  for (const entity of entities ?? []) {
    if (entity.type !== "text_link" || !entity.url) continue;
    const visible = text.slice(entity.offset, entity.offset + entity.length).trim();
    if (!VISIBLE_URL_PATTERN.test(visible)) continue;
    const visibleHost = hostnameOf(visible);
    const actualHost = hostnameOf(entity.url);
    if (visibleHost && actualHost && visibleHost !== actualHost) {
      return actualHost;
    }
  }
  return null;
}

function containsCta(text: string): boolean {
  const lower = text.toLowerCase();
  return CTA_PHRASES.some((phrase) => lower.includes(phrase));
}

function countMentions(entities: MessageEntity[] | undefined): number {
  return (entities ?? []).filter((e) => e.type === "mention" || e.type === "text_mention").length;
}

/**
 * Base (non-LLM) spam heuristics: link volume, blacklisted domains,
 * forwarded-channel-ad pattern, mass mentions.
 */
export function detectSpam(message: Message): SpamResult {
  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities;
  if (!text) return { matched: false };

  const links = extractLinks(text, entities);

  const maskedHost = findMaskedLink(text, entities);
  if (maskedHost) {
    return { matched: true, reason: `маскированная ссылка (ведёт на ${maskedHost})`, severity: "high" };
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

import type { Message } from "grammy/types";
import { extractButtonLinks, extractLinks, countMentions } from "./textSignals";
import { buildAllowlistMatcher } from "./allowlist";

/**
 * ROADMAP.md §7.2 item 2 — opt-in "block outright" rules, modelled on
 * @LolsBot's "Удалять сообщения" toggles (Все ссылки / Все репосты /
 * Все @теги / Всё от каналов / Запретить КАПС). Deliberately layered ON TOP
 * of (not instead of) the pattern-based detectSpam heuristics in spam.ts —
 * those only flag links/forwards/mentions that already *look* malicious;
 * these are for a group that wants zero tolerance regardless of how benign
 * a given instance looks. One multi-select setting, not five toggles (the
 * roadmap item explicitly calls that out) — a group either bans these
 * outright or doesn't, there's no meaningful partial-severity version.
 */
export type StrictContentRule = "links" | "forwards" | "mentions" | "channels" | "caps";

export const ALL_STRICT_CONTENT_RULES: StrictContentRule[] = ["links", "forwards", "mentions", "channels", "caps"];

/** All-caps only counts letters (numbers/punctuation/emoji don't move the
 * needle either way) and requires enough of them that short acronyms/
 * exclamations ("OK", "ВАУ!!!") don't false-positive. */
const CAPS_MIN_LETTERS = 8;

function isAllCaps(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < CAPS_MIN_LETTERS) return false;
  return letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** Returns a human-readable reason for the first configured rule the message
 * trips, or null if none apply. `contentAllowlist` only softens the "links"
 * rule (an admin's own allowlisted domain/channel link is exempt even under
 * "ban all links") — the other rules have no equivalent partial-exception
 * concept in the allowlist's design. */
export function detectStrictContentViolation(
  message: Message,
  rules: StrictContentRule[],
  contentAllowlist: string[] = []
): string | null {
  if (!rules.length) return null;

  if (rules.includes("links")) {
    const text = message.text ?? message.caption ?? "";
    const entities = message.entities ?? message.caption_entities;
    const allLinks = [...extractLinks(text, entities), ...extractButtonLinks(message)];
    if (allLinks.length > 0) {
      const allow = buildAllowlistMatcher(contentAllowlist);
      const hasNonAllowedLink = allow.empty || allLinks.some((l) => !allow.allowsLink(l));
      if (hasNonAllowedLink) return "ссылка (в группе запрещены любые ссылки)";
    }
  }

  if (rules.includes("forwards") && message.forward_origin) {
    return "пересланное сообщение (в группе запрещены любые репосты)";
  }

  // Excludes the chat's own linked-channel auto-posts (is_automatic_forward)
  // — same carve-out @LolsBot documents for this rule ("за исключением
  // привязанного к чату канала"), otherwise a channel-linked discussion
  // group couldn't turn this on at all.
  if (rules.includes("channels") && message.sender_chat && !message.is_automatic_forward) {
    return "сообщение от имени канала (запрещено в этой группе)";
  }

  if (rules.includes("mentions")) {
    const entities = message.entities ?? message.caption_entities;
    if (countMentions(entities) > 0) return "упоминание пользователя (в группе запрещены любые @упоминания)";
  }

  if (rules.includes("caps")) {
    const text = message.text ?? message.caption ?? "";
    if (isAllCaps(text)) return "сообщение целиком заглавными буквами";
  }

  return null;
}

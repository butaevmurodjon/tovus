import type { Message, MessageEntity } from "grammy/types";
import { CTA_PHRASES, DANGEROUS_FILE_EXTENSIONS, DANGEROUS_MIME_TYPES } from "./spamDict";

// Pure, Redis-free text/entity helpers shared by spam.ts (the live binary
// detector) and scoring.ts (the §4 shadow scorer, which re-runs the same
// checks in "collect every match" form). Factored out after review flagged
// the two files carrying byte-identical copies of these functions — letting
// them drift would have undermined the shadow scorer's whole point: its
// divergence numbers are supposed to reflect scoring-model differences, not
// accidental detection-logic skew between two copies of the same code.

export function extractLinks(text: string, entities: MessageEntity[] | undefined): string[] {
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

export function hostnameOf(link: string): string | null {
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
 * ("нажми тут") is not suspicious on its own. Returns the actual (hidden) host.
 */
export function findMaskedLinkHost(text: string, entities: MessageEntity[] | undefined): string | null {
  for (const entity of entities ?? []) {
    if (entity.type !== "text_link" || !entity.url) continue;
    const visible = text.slice(entity.offset, entity.offset + entity.length).trim();
    if (!VISIBLE_URL_PATTERN.test(visible)) continue;
    const visibleHost = hostnameOf(visible);
    const actualHost = hostnameOf(entity.url);
    if (visibleHost && actualHost && visibleHost !== actualHost) return actualHost;
  }
  return null;
}

/**
 * .apk/.exe/.jar-style attachments — fake "official bank/gov app" installers are
 * the dominant malware vector in these group chats, and scammers routinely send
 * them with no caption at all, so this must not depend on message text existing.
 * Both file_name and mime_type are sender-supplied (spoofable), but scammers here
 * generally aren't hiding the extension — the ".apk" is often part of the pitch.
 * Returns the matched extension (with leading dot) or mime type.
 */
export function findDangerousFileTag(message: Message): string | null {
  const doc = message.document;
  if (!doc) return null;
  const name = doc.file_name?.toLowerCase() ?? "";
  const ext = name.match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && DANGEROUS_FILE_EXTENSIONS.includes(ext)) return `.${ext}`;
  if (doc.mime_type && DANGEROUS_MIME_TYPES.includes(doc.mime_type.toLowerCase())) return doc.mime_type;
  return null;
}

export function containsCta(text: string): boolean {
  const lower = text.toLowerCase();
  return CTA_PHRASES.some((phrase) => lower.includes(phrase));
}

export function countMentions(entities: MessageEntity[] | undefined): number {
  return (entities ?? []).filter((e) => e.type === "mention" || e.type === "text_mention").length;
}

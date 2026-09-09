// Pure matching helpers for the per-group content allowlist (lib/db/allowlist.ts).
// Shared by spam.ts, profanity.ts and scoring.ts so the live detector, the
// profanity path and the shadow scorer can't drift apart on what "allowed" means.
//
// An entry is a DOMAIN when it looks like `host[/path]` with a dot in the host
// (`example.com`, `t.me/mychannel`), otherwise a free-text PHRASE. A bare-host
// domain entry matches a host exactly or as a subdomain (same as
// DOMAIN_BLACKLIST). A domain entry WITH a path (`t.me/mychannel`) matches only
// links that start with that exact `host/path` prefix — so allowlisting one
// channel never allows every link on that host.

const DOMAIN_ENTRY = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;

function normalizeLink(link: string): string {
  return link
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

function splitEntries(allowlist: string[]): { hostEntries: string[]; linkEntries: string[]; phrases: string[] } {
  const hostEntries: string[] = [];
  const linkEntries: string[] = [];
  const phrases: string[] = [];
  for (const raw of allowlist) {
    const entry = normalizeLink(raw);
    if (!entry) continue;
    if (DOMAIN_ENTRY.test(entry)) {
      if (entry.includes("/")) linkEntries.push(entry);
      else hostEntries.push(entry);
    } else {
      phrases.push(entry);
    }
  }
  return { hostEntries, linkEntries, phrases };
}

function hostMatches(host: string, hostEntry: string): boolean {
  return host === hostEntry || host.endsWith(`.${hostEntry}`);
}

export interface AllowlistMatcher {
  /** No entries at all — callers can skip the filtering work entirely. */
  empty: boolean;
  /** `host` may be null (hostnameOf failed) — then it's never allowlisted.
   * Only bare-host entries count here (a `host/path` entry needs the full
   * link, see allowsLink). Used for maskedHost / cloakedBotLink checks. */
  allowsHost(host: string | null | undefined): boolean;
  /** True when a full link is covered — a bare-host entry matching its host,
   * or a `host/path` entry that the link starts with. Used to filter the
   * extracted link list. */
  allowsLink(link: string): boolean;
  /** True when `phrase` (a dictionary phrase like a SCAM_PATTERNS entry) is
   * itself allowlisted — case-insensitive substring either direction. Used to
   * suppress one matched pattern, not to scan the whole message. */
  allowsPhrase(phrase: string): boolean;
  /** True when the message text contains an allowlisted phrase — used by the
   * profanity path where the matched token is a fragment, not a dictionary phrase. */
  textHasAllowedPhrase(text: string): boolean;
}

export function buildAllowlistMatcher(allowlist: string[] | undefined | null): AllowlistMatcher {
  const { hostEntries, linkEntries, phrases } = splitEntries(allowlist ?? []);
  const empty = hostEntries.length === 0 && linkEntries.length === 0 && phrases.length === 0;
  return {
    empty,
    allowsHost(host) {
      if (!host) return false;
      const h = host.toLowerCase();
      return hostEntries.some((d) => hostMatches(h, d));
    },
    allowsLink(link) {
      const l = normalizeLink(link);
      if (!l) return false;
      const host = l.split(/[/?#]/)[0];
      return hostEntries.some((d) => hostMatches(host, d)) || linkEntries.some((e) => l === e || l.startsWith(e));
    },
    allowsPhrase(phrase) {
      const p = phrase.toLowerCase();
      return phrases.some((a) => p.includes(a) || a.includes(p));
    },
    textHasAllowedPhrase(text) {
      if (phrases.length === 0) return false;
      const t = text.toLowerCase();
      return phrases.some((a) => t.includes(a));
    },
  };
}

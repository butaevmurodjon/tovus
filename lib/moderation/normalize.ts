/**
 * Minimal normalization shared by fuzzy-comparison callers (§4.3 in TZ.md).
 * Deliberately does NOT include the confusable-character substitution table
 * (0/о, 3/е, etc.) described in the full spec — that's a separate, tested
 * sub-project and isn't wired into detectProfanity/detectSpam/hashText yet.
 */
export function normalizeMessageText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

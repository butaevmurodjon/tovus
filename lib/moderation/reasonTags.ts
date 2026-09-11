import type { ReasonTag, ViolationCategory } from "@/lib/db/types";

// Substring markers pulled straight from the exact reason strings detectSpam
// (spam.ts) produces. "призыв" (not "призыв к действию") deliberately
// matches on the stem — spam.ts phrases the CTA marker in two different
// grammatical cases ("...с призывом к действию" vs "...призыв к действию"),
// and the stem covers both without needing two near-duplicate entries.
const PHISHING_MARKERS = [
  "запрещённый домен",
  "маскированная ссылка",
  "ссылка-приглашение",
  "замаскировано под ссылку на бота",
];
const ADS_MARKERS = ["реклама", "призыв", "ссылок в сообщении", "массовые упоминания"];

/**
 * Pure classifier: collapses a moderation verdict's (source, reason) pair
 * into one coarse ReasonTag for the monthly digest breakdown. `category` is
 * accepted for signature parity with ModerationVerdict (and in case a future
 * branch needs to disambiguate two sources sharing the same category) but
 * every current branch is decided from `source`/`reason` alone.
 */
export function classifyReasonTag(
  source: string | null | undefined,
  reason: string,
  category: ViolationCategory
): ReasonTag {
  // Not consulted by any branch below today — kept for signature parity with
  // ModerationVerdict and in case a future branch needs to disambiguate two
  // sources sharing the same category. `void` avoids an unused-param lint
  // error without renaming the parameter away from its documented meaning.
  void category;

  if (source === "profanity") return "profanity";
  if (source === "premium-ai") return "ai";
  if (source === "flood") return "flood";

  if (source === "spam-detector") {
    // Dangerous-file verdicts always open with this exact phrase (spam.ts) —
    // checked first since a file tag alone shouldn't fall through to the
    // includes()-based scam/phishing/ads checks below.
    if (reason.startsWith("опасный тип файла")) return "apk";
    if (reason.includes("скам-схема")) return "scam";
    if (PHISHING_MARKERS.some((marker) => reason.includes(marker))) return "phishing_link";
    if (ADS_MARKERS.some((marker) => reason.includes(marker))) return "ads";
    return "other";
  }

  // restricted-content / night-mode / anything unrecognized.
  return "other";
}

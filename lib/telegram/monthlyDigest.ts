import type { MonthlyDigestStats } from "@/lib/db/stats";
import type { ReasonTag } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";

// Roughly "how bad" ordering for the breakdown — dangerous files/scams/
// phishing first, cheap cleanup noise (flood/other) last. Every ReasonTag has
// an entry here; buildDigestMessage skips whichever ones are 0 for this group.
export const TAG_ORDER: { tag: ReasonTag; key: string }[] = [
  { tag: "apk", key: "bot.digestTagApk" },
  { tag: "scam", key: "bot.digestTagScam" },
  { tag: "phishing_link", key: "bot.digestTagPhishingLink" },
  { tag: "ads", key: "bot.digestTagAds" },
  { tag: "profanity", key: "bot.digestTagProfanity" },
  { tag: "ai", key: "bot.digestTagAi" },
  { tag: "cas", key: "bot.digestTagCas" },
  { tag: "raid", key: "bot.digestTagRaid" },
  { tag: "globalban", key: "bot.digestTagGlobalban" },
  { tag: "flood", key: "bot.digestTagFlood" },
  { tag: "other", key: "bot.digestTagOther" },
];

/**
 * Pure message builder for the monthly digest, separated from the actual
 * ctx.api.sendMessage/getApi() call (see app/api/cron/monthly-digest) so it's
 * testable without a live bot or Redis.
 *
 * Owner scope decision: quiet groups still get a message, never a skip. A
 * `total` of exactly 0 is the one case the spec actually asks to distinguish
 * ("a positive one-liner for a quiet month, near-zero total") and the only
 * one worth testing precisely — a fuzzy "near-zero but not exactly zero"
 * threshold would be a real product call this task doesn't pin down, so it's
 * left for a future iteration rather than guessed at here.
 */
export function buildDigestMessage(stats: MonthlyDigestStats, lang: Lang): string {
  if (stats.total === 0) {
    return t(lang, "bot.digestHeader") + "\n" + t(lang, "bot.digestQuiet", { total: stats.total });
  }

  const lines = [t(lang, "bot.digestHeader"), t(lang, "bot.digestTotal", { total: stats.total })];
  for (const { tag, key } of TAG_ORDER) {
    const count = stats.byTag[tag];
    if (count > 0) lines.push(t(lang, key, { count }));
  }
  return lines.join("\n");
}

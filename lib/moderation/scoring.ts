import type { Message } from "grammy/types";
import type { GroupSettings, ViolationCategory } from "@/lib/db/types";
import type { ModerationSource } from "./index";
import {
  DOMAIN_BLACKLIST,
  DUPLICATE_MAX_COUNT,
  FLOOD_MAX_MESSAGES,
  LINK_COUNT_THRESHOLD,
  MENTION_COUNT_THRESHOLD,
  QUOTE_AD_MARKERS,
  SCAM_PATTERNS,
} from "./spamDict";
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
import { isNightModeActive } from "./nightMode";
import { getReputationScore } from "./reputation";
import { isWithinNewMemberWindow, peekDuplicateFloodCount, peekUserFloodCount } from "./flood";
import { classifyDivergence, recordShadowScoring, type DivergenceSample } from "@/lib/db/shadowStats";

// §4 Этап 1 — shadow-only scoring engine. Deliberately scoped down from the
// full §4 pipeline for this first commit (see the reasoning below and in the
// TZ.md checklist under §4). This module NEVER changes what the bot does —
// see runShadowScoring's caller in bot.ts, which fires this after the real
// verdict is already decided and never awaits it into the response path.

export type ModerationV2Mode = "off" | "shadow" | "on";

/** Read once per call (no module-level caching — env vars don't change at
 * runtime here, and re-reading is free), never throws: an unrecognized value
 * degrades to "off" rather than risking a 500 on a typo'd env var (§4.11). */
export function moderationV2Mode(): ModerationV2Mode {
  const raw = process.env.MODERATION_V2;
  return raw === "shadow" || raw === "on" ? raw : "off";
}

export interface Signal {
  name: string;
  weight: number;
  evidence: string;
  /** Signals in the same group are mutually exclusive for scoring purposes
   * (§4.11) — only the highest-weight match in a group counts toward the
   * sum. All matches still appear in the signals list for calibration. */
  group?: "link-risk";
}

export type Zone = "ok" | "warn" | "escalate";

export interface ScoreResult {
  score: number;
  zone: Zone;
  signals: Signal[];
}

// §4.7.
const ZONE_OK_MAX = 20;
const ZONE_WARN_MAX = 59;

function zoneFor(score: number): Zone {
  if (score <= ZONE_OK_MAX) return "ok";
  if (score <= ZONE_WARN_MAX) return "warn";
  return "escalate";
}

// --- Signal collection (§4.4) -----------------------------------------------
// Ported from spam.ts's detectors, which are pure functions of the message
// (no Redis, no side effects) — safe to re-run here independent of whatever
// branch the real pipeline took. Unlike spam.ts, this collects EVERY matching
// signal instead of stopping at the first, so two independent facts (e.g. a
// blacklisted domain AND mass mentions) both show up in the evidence list —
// §4.11's "only the group max counts toward the sum" is applied in
// scoreSignals below, not here. The underlying pure text/entity helpers
// (extractLinks, hostnameOf, findMaskedLinkHost, findCloakedBotLink,
// findDangerousFileTag, containsCta, countMentions) live in ./textSignals, shared with spam.ts, so
// the two detectors can't silently drift apart on link/CTA/file logic. Same
// goes for extractQuote, used below to score the "quote-relay" evasion.

/** Collects every spam-related signal that matches, with §4.4's weights. Pure
 * function of the message — no Redis, safe to call unconditionally. */
export function collectSpamSignals(message: Message): Signal[] {
  const signals: Signal[] = [];

  const dangerousFile = findDangerousFileTag(message);
  if (dangerousFile) {
    signals.push({ name: "dangerous_file", weight: 100, evidence: dangerousFile, group: "link-risk" });
  }

  // Mirrors spam.ts's quote-relay check (see extractQuote's docstring) —
  // collected here too so the shadow scorer already models this evasion by
  // the time §11.3 promotes it toward gating real actions.
  const quote = extractQuote(message);
  if (quote) {
    const quoteLower = quote.text.toLowerCase();
    const quoteScamPattern = SCAM_PATTERNS.find((phrase) => quoteLower.includes(phrase));
    if (quoteScamPattern) {
      signals.push({ name: "quote_scam_pattern", weight: 90, evidence: quoteScamPattern, group: "link-risk" });
    }
    const quoteLinks = extractLinks(quote.text, quote.entities);
    for (const link of quoteLinks) {
      const host = hostnameOf(link);
      if (host && DOMAIN_BLACKLIST.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
        signals.push({ name: "quote_blacklisted_domain", weight: 85, evidence: host, group: "link-risk" });
        break;
      }
    }
    const quotePromo = QUOTE_AD_MARKERS.find((phrase) => quoteLower.includes(phrase));
    if (quotePromo) {
      signals.push({ name: "quote_ad_relay", weight: 75, evidence: quotePromo, group: "link-risk" });
    } else if (containsCta(quote.text)) {
      // Weaker than quote_ad_relay/forward_cta: a bare CTA phrase inside a
      // quote is just as consistent with quoting a spam message to warn about
      // it as with relaying one — see spam.ts's identical severity split.
      signals.push({ name: "quote_cta", weight: 25, evidence: "cta-in-quote", group: "link-risk" });
    }
  }

  const text = message.text ?? message.caption ?? "";
  if (!text) return signals;
  const entities = message.entities ?? message.caption_entities;

  const scamPattern = SCAM_PATTERNS.find((phrase) => text.toLowerCase().includes(phrase));
  if (scamPattern) {
    signals.push({ name: "scam_pattern", weight: 90, evidence: scamPattern, group: "link-risk" });
  }

  const links = extractLinks(text, entities);

  const maskedHost = findMaskedLinkHost(text, entities);
  if (maskedHost) {
    signals.push({ name: "masked_link", weight: 90, evidence: maskedHost, group: "link-risk" });
  }

  const cloakedBotLink = findCloakedBotLink(text, entities);
  if (cloakedBotLink) {
    signals.push({ name: "cloaked_bot_link", weight: 90, evidence: cloakedBotLink, group: "link-risk" });
  }

  for (const link of links) {
    const host = hostnameOf(link);
    if (host && DOMAIN_BLACKLIST.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      signals.push({ name: "blacklisted_domain", weight: 85, evidence: host, group: "link-risk" });
      break; // one hit is enough evidence; don't let 3 blacklisted links triple-count
    }
  }
  if (links.some((l) => /^t\.me\/(joinchat|\+)/i.test(l.replace(/^https?:\/\//, "")))) {
    signals.push({ name: "invite_link", weight: 80, evidence: "t.me invite", group: "link-risk" });
  }

  const isForwarded = Boolean(message.forward_origin);
  const cta = containsCta(text);
  if (isForwarded && cta) {
    signals.push({ name: "forward_cta", weight: 70, evidence: "forward+cta", group: "link-risk" });
  } else if (links.length > 0 && cta) {
    signals.push({ name: "link_cta", weight: 65, evidence: "link+cta", group: "link-risk" });
  }

  if (links.length >= LINK_COUNT_THRESHOLD + 1) {
    signals.push({ name: "link_count_high", weight: 55, evidence: `${links.length} links`, group: "link-risk" });
  } else if (links.length >= LINK_COUNT_THRESHOLD) {
    signals.push({ name: "link_count_low", weight: 30, evidence: `${links.length} links`, group: "link-risk" });
  }

  // §4.11: the CTA phrase is one fact — it must not enter the sum twice. If
  // forward_cta/link_cta already counted it (as part of the link-risk group
  // above), mention_cta/cta_alone must not also count it standalone.
  const ctaAlreadyCounted = signals.some((s) => s.name === "forward_cta" || s.name === "link_cta");
  const mentions = countMentions(entities);
  if (mentions >= MENTION_COUNT_THRESHOLD) {
    signals.push({ name: "mass_mentions", weight: 45, evidence: `${mentions} mentions` });
  } else if (mentions > 0 && cta && !ctaAlreadyCounted) {
    signals.push({ name: "mention_cta", weight: 35, evidence: "mention+cta" });
  } else if (cta && !ctaAlreadyCounted) {
    // §4.4's standalone "CTA phrase alone" row — no equivalent check existed
    // in spam.ts (which only ever paired CTA with a link/forward/mention), so
    // this is new *evidence collection*, not a behavior change: shadow-only,
    // never was and isn't now wired to any real action.
    signals.push({ name: "cta_alone", weight: 20, evidence: "cta" });
  }

  return signals;
}

// --- Scoring (§4.5, §4.7, §4.11) --------------------------------------------

/** Sums signals per §4.11: only the highest-weight "link-risk" signal counts
 * (they're evidence of the same underlying risk, not independent facts), all
 * other signals are additive, then the reputation modifier is applied and the
 * total clamped to 0..100. */
// §4.4: flat modifier for a chat-userbase account under 7 days old, applied
// on top of everything else — see the isNewAccount handling in scoreSignals
// for why it's added last rather than folded into the signal sum.
const NEW_ACCOUNT_MODIFIER = 10;

export function scoreSignals(signals: Signal[], reputationScore: number, isNewAccount = false): ScoreResult {
  const groupMax = Math.max(0, ...signals.filter((s) => s.group === "link-risk").map((s) => s.weight));
  const additive = signals.filter((s) => s.group !== "link-risk").reduce((sum, s) => sum + s.weight, 0);

  let score = groupMax + additive;
  // §4.5: score >= 60 forces at least the warn zone even if the message's own
  // signals are weak; score >= 30 adds a flat +20 modifier. Never applied the
  // other way around — reputation can only push toward warn/escalate, never
  // reduce a score a message's own content earned.
  if (reputationScore >= 60) score = Math.max(score, ZONE_OK_MAX + 1);
  else if (reputationScore >= 30) score += 20;

  // Added after the reputation floor/tier above, not folded into the additive
  // sum before it: applying it earlier risks the score>=60 floor's Math.max
  // silently swallowing it (0 signals + isNewAccount alone would score 10,
  // then the floor still forces 21 regardless — the +10 would have no
  // effect at all for that user). Applying it last guarantees it always
  // moves the score, matching "flat +10 modifier" in §4.4's table.
  if (isNewAccount) score += NEW_ACCOUNT_MODIFIER;

  score = Math.min(100, Math.max(0, score));
  return { score, zone: zoneFor(score), signals };
}

/** True when no message-content signal fired and the zone is still above
 * "ok" — meaning a modifier (reputation floor/tier, or the new-account
 * +10) did all the work. An empty signal list still scores 21 ("warn") once
 * reputationScore >= 60, or 30 ("warn") at reputationScore >= 30 combined
 * with isNewAccount (see scoreSignals above). Tracked separately in the
 * shadow metrics so a spike in repeat offenders or new joins doesn't get
 * misread as "the scorer is over-triggering on content" (it isn't looking
 * at content at all in that case). */
export function isReputationOnlyTrigger(signals: Signal[], zone: Zone): boolean {
  return signals.length === 0 && zone !== "ok";
}

// --- Shadow orchestration ----------------------------------------------------

interface ShadowLogEntry {
  chatId: number;
  messageId: number;
  oldCategory: ViolationCategory | null;
  /** False when the old verdict came from a detector this scorer doesn't
   * model yet (flood, profanity, premium-ai, restricted-content, night-mode)
   * — those aren't calibration data, they're "not modeled," and mixing them
   * into the same divergence count makes weight-tuning problems and plumbing
   * gaps indistinguishable. True when nothing fired (both sides agree: ok)
   * or when the old verdict came from spam-detector (the only source this
   * scorer actually models). */
  comparable: boolean;
  score: number;
  zone: Zone;
  signals: { name: string; weight: number }[];
  divergence: "agree" | "stricter" | "looser" | null;
  latencyMs: number;
}

const MODELED_SOURCE: ModerationSource = "spam-detector";

/**
 * Computes the shadow score for a message and logs a comparison against what
 * the real (old) pipeline decided — never affects that decision. Called from
 * bot.ts, after the real verdict is already final; awaited but wrapped in
 * .catch() there so a failure here can never surface as a moderation error.
 *
 * Flood/duplicate-flood signals and the new-account modifier (§4.4/§4.5) read
 * flood.ts's peekUserFloodCount/peekDuplicateFloodCount/isWithinNewMemberWindow
 * — read-only, never the mutating checkUserFlood/checkDuplicateFlood/
 * consumeNewMemberFlag the real pipeline uses, so nothing here double-counts
 * toward a real threshold. See those functions' docstrings for the
 * staleness caveat this implies (the flood peeks especially under-fire on
 * messages the old spam-detector already flagged).
 *
 * Still deliberately out of scope (see TZ.md §4 checklist / §11.3):
 *  - DeepSeek as a scoring signal (§4.6) — rewiring classifyWithDeepseek's
 *    trigger condition touches the live premium-tier path, which is exactly
 *    what shadow mode exists to avoid touching first;
 *  - §5's fuzzy-duplicate signal — §5 doesn't exist yet.
 * Both are safe to add later, incrementally, once this baseline is
 * validated — see §11.3 for the intended order.
 */
export async function runShadowScoring(
  message: Message,
  settings: GroupSettings,
  oldVerdict: { category: ViolationCategory; source?: ModerationSource } | null,
  options: { isEdit?: boolean } = {}
): Promise<void> {
  if (moderationV2Mode() === "off") return;
  // Same reasoning as index.ts's flood counters (§4's own checkUserFlood
  // guard): an edit isn't a new message event. Without this, re-scoring every
  // edit under the same messageId inflates the shadow-stats "total" and can
  // push several divergenceSample entries for one edited message into the
  // 300-slot buffer, corrupting both the counters and the hand-labeling
  // export (§11.4) — found in review, not in the original commit.
  if (options.isEdit) return;
  // Every message gets forced through during quiet hours regardless of
  // content (see moderation/index.ts) — scoring it would just log a
  // content-based divergence that has nothing to do with why the old
  // pipeline actually acted. Skipping keeps the shadow sample meaningful,
  // at the cost of under-representing night-hours traffic.
  if (isNightModeActive(settings)) return;
  // Matches the real pipeline's own gates: content is only ever looked at
  // when antispam OR restrictNewMembersEnabled is on (restricted-content
  // fires independently of antispam, see index.ts). Skipping only when BOTH
  // are off — skipping on antispam alone would silently zero out shadow
  // coverage for a whole chat that still has real moderation happening via
  // the new-member restriction path.
  if (!settings.antispam && !settings.restrictNewMembersEnabled) return;

  const userId = message.from?.id;
  if (!userId) return;

  // Measures only the scorer's own work — collection + these reads +
  // scoring — not the metrics write below, so this is a proxy for what "on"
  // mode would actually cost (§2's p95 ≤250ms budget), not for shadow mode's
  // own (strictly larger) overhead.
  const startedAt = performance.now();
  const signals = collectSpamSignals(message);
  const text = message.text ?? message.caption ?? "";
  // Promise.all rather than a single Redis pipeline: these four reads cross
  // three modules (reputation.ts, flood.ts x3), and reaching into their key
  // builders to batch one HTTP round trip isn't worth breaking that
  // encapsulation for — this still dispatches all four concurrently instead
  // of serially.
  const [reputationScore, userFloodCount, dupFloodCount, isNewAccount] = await Promise.all([
    getReputationScore(settings.chatId, userId).catch(() => 0),
    peekUserFloodCount(settings.chatId, userId).catch(() => 0),
    peekDuplicateFloodCount(settings.chatId, text).catch(() => 0),
    isWithinNewMemberWindow(settings.chatId, userId).catch(() => false),
  ]);
  // §4.4: flat weights when the real pipeline's own trip conditions
  // (checkUserFlood/checkDuplicateFlood) would have fired, mirrored exactly
  // so the shadow number means the same thing the real threshold does.
  if (userFloodCount > FLOOD_MAX_MESSAGES) {
    signals.push({ name: "user_flood", weight: 50, evidence: `${userFloodCount} messages` });
  }
  if (dupFloodCount > DUPLICATE_MAX_COUNT) {
    signals.push({ name: "duplicate_flood", weight: 60, evidence: `${dupFloodCount} repeats` });
  }
  const result = scoreSignals(signals, reputationScore, isNewAccount);
  const latencyMs = performance.now() - startedAt;

  const oldCategory = oldVerdict?.category ?? null;
  const comparable = oldVerdict === null || oldVerdict.source === MODELED_SOURCE;
  const divergence = classifyDivergence(comparable, oldCategory, result.zone);
  const namedSignals = result.signals.map((s) => ({ name: s.name, weight: s.weight }));

  const entry: ShadowLogEntry = {
    chatId: settings.chatId,
    messageId: message.message_id,
    oldCategory,
    comparable,
    score: result.score,
    zone: result.zone,
    // Never log free-text evidence (§11.4: no raw text/username/user ID in
    // metrics) — name+weight is enough to see which detectors fired.
    signals: namedSignals,
    divergence,
    latencyMs: Math.round(latencyMs),
  };
  console.log("[moderation_v2_shadow]", JSON.stringify(entry));

  // Skip when there's nothing to hand-label: an empty signal list (the
  // reputation-floor-only case, tracked separately above) would otherwise
  // flood the 300-slot sample with content-free entries from a handful of
  // chatty repeat offenders, evicting the content divergences §11.4's
  // hand-labeling actually needs.
  const divergenceSample: DivergenceSample | null =
    divergence && divergence !== "agree" && signals.length > 0
      ? { messageId: message.message_id, score: result.score, zone: result.zone, oldCategory, divergence, signals: namedSignals }
      : null;

  await recordShadowScoring(settings.chatId, {
    zone: result.zone,
    latencyMs,
    comparable,
    oldCategory,
    reputationOnlyTrigger: isReputationOnlyTrigger(signals, result.zone),
    divergenceSample,
  }).catch(() => {});
}

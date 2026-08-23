import type { Message, MessageEntity } from "grammy/types";
import type { GroupSettings, ViolationCategory } from "@/lib/db/types";
import type { ModerationSource } from "./index";
import {
  CTA_PHRASES,
  DANGEROUS_FILE_EXTENSIONS,
  DANGEROUS_MIME_TYPES,
  DOMAIN_BLACKLIST,
  LINK_COUNT_THRESHOLD,
  MENTION_COUNT_THRESHOLD,
  SCAM_PATTERNS,
} from "./spamDict";
import { isNightModeActive } from "./nightMode";
import { getReputationScore } from "./reputation";

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
// scoreSignals below, not here.

function extractLinks(text: string, entities: MessageEntity[] | undefined): string[] {
  const links: string[] = [];
  for (const entity of entities ?? []) {
    if (entity.type === "text_link" && entity.url) links.push(entity.url);
    else if (entity.type === "url") links.push(text.slice(entity.offset, entity.offset + entity.length));
  }
  if (links.length === 0) {
    const urlRegex = /(https?:\/\/|t\.me\/|www\.)[^\s]+/gi;
    for (const match of text.matchAll(urlRegex)) links.push(match[0]);
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

function findMaskedLinkHost(text: string, entities: MessageEntity[] | undefined): string | null {
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

function findDangerousFileTag(message: Message): string | null {
  const doc = message.document;
  if (!doc) return null;
  const name = doc.file_name?.toLowerCase() ?? "";
  const ext = name.match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && DANGEROUS_FILE_EXTENSIONS.includes(ext)) return `.${ext}`;
  if (doc.mime_type && DANGEROUS_MIME_TYPES.includes(doc.mime_type.toLowerCase())) return doc.mime_type;
  return null;
}

function containsCta(text: string): boolean {
  const lower = text.toLowerCase();
  return CTA_PHRASES.some((phrase) => lower.includes(phrase));
}

function countMentions(entities: MessageEntity[] | undefined): number {
  return (entities ?? []).filter((e) => e.type === "mention" || e.type === "text_mention").length;
}

/** Collects every spam-related signal that matches, with §4.4's weights. Pure
 * function of the message — no Redis, safe to call unconditionally. */
export function collectSpamSignals(message: Message): Signal[] {
  const signals: Signal[] = [];

  const dangerousFile = findDangerousFileTag(message);
  if (dangerousFile) {
    signals.push({ name: "dangerous_file", weight: 100, evidence: dangerousFile, group: "link-risk" });
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
export function scoreSignals(signals: Signal[], reputationScore: number): ScoreResult {
  const groupMax = Math.max(0, ...signals.filter((s) => s.group === "link-risk").map((s) => s.weight));
  const additive = signals.filter((s) => s.group !== "link-risk").reduce((sum, s) => sum + s.weight, 0);

  let score = groupMax + additive;
  // §4.5: score >= 60 forces at least the warn zone even if the message's own
  // signals are weak; score >= 30 adds a flat +20 modifier. Never applied the
  // other way around — reputation can only push toward warn/escalate, never
  // reduce a score a message's own content earned.
  if (reputationScore >= 60) score = Math.max(score, ZONE_OK_MAX + 1);
  else if (reputationScore >= 30) score += 20;

  score = Math.min(100, Math.max(0, score));
  return { score, zone: zoneFor(score), signals };
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
}

const MODELED_SOURCE: ModerationSource = "spam-detector";

/**
 * Computes the shadow score for a message and logs a comparison against what
 * the real (old) pipeline decided — never affects that decision. Called from
 * bot.ts, after the real verdict is already final; awaited but wrapped in
 * .catch() there so a failure here can never surface as a moderation error.
 *
 * Deliberately out of scope for this first commit (see TZ.md §4 checklist):
 *  - flood/duplicate-flood signals (checkUserFlood/checkDuplicateFlood are
 *    INCR-based reads — calling them here would double-count every message
 *    toward the real flood threshold);
 *  - the "new account (<7d)" modifier (would need consumeNewMemberFlag, a
 *    one-shot GET→DEL already consumed by the real pipeline);
 *  - DeepSeek as a scoring signal (§4.6) — rewiring classifyWithDeepseek's
 *    trigger condition touches the live premium-tier path, which is exactly
 *    what shadow mode exists to avoid touching first;
 *  - §5's fuzzy-duplicate signal — §5 doesn't exist yet.
 * All of these are safe to add later, incrementally, once this baseline is
 * validated — see §11.3 for the intended order.
 */
export async function runShadowScoring(
  message: Message,
  settings: GroupSettings,
  oldVerdict: { category: ViolationCategory; source?: ModerationSource } | null
): Promise<void> {
  if (moderationV2Mode() === "off") return;
  // Every message gets forced through during quiet hours regardless of
  // content (see moderation/index.ts) — scoring it would just log a
  // content-based divergence that has nothing to do with why the old
  // pipeline actually acted. Skipping keeps the shadow sample meaningful,
  // at the cost of under-representing night-hours traffic.
  if (isNightModeActive(settings)) return;
  // Matches the real pipeline's own gate — comparing "would the scorer have
  // flagged this" only makes sense where the old pipeline was actually
  // looking for spam at all.
  if (!settings.antispam) return;

  const userId = message.from?.id;
  if (!userId) return;

  const signals = collectSpamSignals(message);
  const reputationScore = await getReputationScore(settings.chatId, userId).catch(() => 0);
  const result = scoreSignals(signals, reputationScore);

  const entry: ShadowLogEntry = {
    chatId: settings.chatId,
    messageId: message.message_id,
    oldCategory: oldVerdict?.category ?? null,
    comparable: oldVerdict === null || oldVerdict.source === MODELED_SOURCE,
    score: result.score,
    zone: result.zone,
    // Never log free-text evidence (§11.4: no raw text/username/user ID in
    // metrics) — name+weight is enough to see which detectors fired.
    signals: result.signals.map((s) => ({ name: s.name, weight: s.weight })),
  };
  console.log("[moderation_v2_shadow]", JSON.stringify(entry));
}

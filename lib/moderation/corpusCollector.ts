import type { Message, MessageEntity } from "grammy/types";
import type { GroupSettings } from "@/lib/db/types";
import type { ModerationVerdict } from "./index";
import { collectSpamSignals, scoreSignals } from "./scoring";
import { extractLinks, extractQuote, hostnameOf, countMentions } from "./textSignals";
import { guessLang } from "./langGuess";
import { hasAnyLink } from "./spam";
import { classifyWithDeepseekShadow } from "./deepseek";
import type { ViolationCategory } from "@/lib/db/types";
import {
  corpusAiSampleRate,
  corpusEnabled,
  recordCorpusSample,
  type AiLabel,
  type CorpusSample,
  type GoldLabel,
  type GoldSource,
} from "@/lib/db/corpus";

const AI_MODEL = "deepseek-chat";

/** A message earns a corpus row if it carries enough to be a useful training
 * example: real own text, a relayed quote, a forward, a link, or any verdict. */
function isCollectable(message: Message, verdict: ModerationVerdict | null): boolean {
  if (verdict) return true;
  const text = (message.text ?? message.caption ?? "").trim();
  if (text.length >= 6) return true;
  if (extractQuote(message)) return true;
  if (message.forward_origin) return true;
  return hasAnyLink(message);
}

/** Non-trivial enough to be worth spending a shadow DeepSeek call on. */
function worthAiSample(message: Message): boolean {
  const text = (message.text ?? message.caption ?? "").trim();
  return text.length >= 12 || hasAnyLink(message) || Boolean(extractQuote(message)) || Boolean(message.forward_origin);
}

function displayNameOf(from: Message["from"]): string | null {
  if (!from) return null;
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
}

/**
 * Assembles one training-corpus row for a message the live pipeline just
 * finished with, and (for non-premium groups, on a 1-in-N sample) attaches a
 * shadow DeepSeek label. Silver-labelled only — `gold*` fields stay null here;
 * confirmed labels come from admin actions (/spam, /ham, journal restore, ban).
 *
 * Pure-ish: re-runs the same pure detectors the shadow scorer uses
 * (collectSpamSignals / scoreSignals) rather than threading state out of
 * moderateMessage. Must be called off the hot path (after()) — it may make one
 * DeepSeek call and one Redis write.
 */
export async function collectModerationSample(
  message: Message,
  settings: GroupSettings,
  verdict: ModerationVerdict | null,
  options: { isEdit?: boolean } = {}
): Promise<void> {
  if (!corpusEnabled()) return;
  if (options.isEdit) return; // an edit isn't a new message event — same rule as runShadowScoring
  if (!isCollectable(message, verdict)) return;

  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities;
  const quote = extractQuote(message);

  const signals = collectSpamSignals(message);
  // Content-only score (reputation/new-account modifiers deliberately excluded
  // — those are separate axes already tracked elsewhere; the corpus wants a
  // feature that depends on the message alone).
  const scored = scoreSignals(signals, 0, false);

  const linkDomains = Array.from(
    new Set(
      extractLinks(text, entities)
        .map(hostnameOf)
        .filter((h): h is string => Boolean(h))
    )
  );

  let aiLabel: AiLabel | null = null;
  let aiReason: string | null = null;
  let aiModel: string | null = null;
  let aiSampled = false;

  if (verdict?.source === "premium-ai") {
    // Real premium verdict already computed by moderateMessage — free to capture.
    aiLabel = verdict.aiCategory ?? "spam";
    aiReason = verdict.reason;
    aiModel = AI_MODEL;
  } else if (!settings.premium && shouldAiSample(message)) {
    const cls = await classifyWithDeepseekShadow(text, quote?.text ? { quotedText: quote.text } : {}).catch(() => null);
    if (cls) {
      aiLabel = cls.violation ? cls.category : "none";
      aiReason = cls.reason;
      aiModel = AI_MODEL;
      aiSampled = true;
    }
  }

  const sample: CorpusSample = {
    chatId: settings.chatId,
    messageId: message.message_id,
    userId: message.from?.id ?? null,
    username: message.from?.username ?? null,
    displayName: displayNameOf(message.from),
    text,
    hasLink: linkDomains.length > 0 || hasAnyLink(message),
    linkDomains,
    mentionCount: countMentions(entities),
    isForward: Boolean(message.forward_origin),
    quotedText: quote?.text ?? null,
    langGuess: guessLang(text || quote?.text || ""),
    detVerdict: verdict?.category ?? null,
    detSource: verdict?.source ?? null,
    detSeverity: null,
    detSignals: signals.map((s) => ({ name: s.name, weight: s.weight })),
    scorerScore: scored.score,
    scorerZone: scored.zone,
    aiLabel,
    aiReason,
    aiModel,
    aiSampled,
    goldLabel: null,
    goldSource: null,
    goldBy: null,
  };

  await recordCorpusSample(sample).catch(() => {});
}

/** Deterministic 1-in-N sampling keyed on the message id (monotonic per chat),
 * so it's reproducible and evenly spread. Rate 0 / unset disables it. */
function shouldAiSample(message: Message): boolean {
  const rate = corpusAiSampleRate();
  if (rate <= 0) return false;
  if (!worthAiSample(message)) return false;
  return message.message_id % rate === 0;
}

/**
 * Records a corpus row carrying a CONFIRMED (gold) label from an admin action —
 * a /spam or /ham reply, a journal restore (false positive), or a manual ban.
 * These are worth far more than silver labels, so this bypasses the
 * `isCollectable` filter and the dedup skip is still honored inside
 * recordCorpusSample (a repeated /spam on the same template just bumps the
 * counter, which is fine).
 *
 * Pass `message` when the full object is on hand (the /spam|/ham reply target)
 * so signals/score get filled; the restore/ban paths only have text + identity.
 */
export async function recordAdminLabel(input: {
  chatId: number;
  messageId: number;
  userId: number | null;
  username?: string | null;
  displayName?: string | null;
  text: string;
  entities?: MessageEntity[];
  isForward?: boolean;
  /** What the bot's own pipeline decided about this message, when known — e.g.
   * a journal restore carries the category the bot flagged it under, which
   * paired with goldLabel "none" is the exact false-positive signal. */
  detVerdict?: ViolationCategory | null;
  detSource?: string | null;
  goldLabel: GoldLabel;
  goldSource: GoldSource;
  goldBy: number;
  message?: Message;
}): Promise<"stored" | "duplicate" | "skipped"> {
  if (!corpusEnabled()) return "skipped";

  const { message } = input;
  const signals = message ? collectSpamSignals(message) : [];
  const scored = signals.length > 0 ? scoreSignals(signals, 0, false) : null;
  const quote = message ? extractQuote(message) : null;
  const entities = input.entities ?? message?.entities ?? message?.caption_entities;

  const linkDomains = Array.from(
    new Set(
      extractLinks(input.text, entities)
        .map(hostnameOf)
        .filter((h): h is string => Boolean(h))
    )
  );

  const sample: CorpusSample = {
    chatId: input.chatId,
    messageId: input.messageId,
    userId: input.userId,
    username: input.username ?? null,
    displayName: input.displayName ?? null,
    text: input.text,
    hasLink: linkDomains.length > 0,
    linkDomains,
    mentionCount: countMentions(entities),
    isForward: input.isForward ?? Boolean(message?.forward_origin),
    quotedText: quote?.text ?? null,
    langGuess: guessLang(input.text || quote?.text || ""),
    detVerdict: input.detVerdict ?? null,
    detSource: input.detSource ?? null,
    detSeverity: null,
    detSignals: signals.map((s) => ({ name: s.name, weight: s.weight })),
    scorerScore: scored?.score ?? null,
    scorerZone: scored?.zone ?? null,
    aiLabel: null,
    aiReason: null,
    aiModel: null,
    aiSampled: false,
    goldLabel: input.goldLabel,
    goldSource: input.goldSource,
    goldBy: input.goldBy,
  };

  return recordCorpusSample(sample).catch(() => "skipped" as const);
}

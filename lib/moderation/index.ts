import type { Message } from "grammy/types";
import type { GroupSettings, ViolationCategory } from "@/lib/db/types";
import { getCustomWords } from "@/lib/db/customWords";
import { isProActive } from "@/lib/billing/plan";
import { detectProfanity } from "./profanity";
import { detectSpam, hasAnyLink } from "./spam";
import { checkDuplicateFlood, checkUserFlood, consumeNewMemberFlag } from "./flood";
import { classifyWithDeepseek } from "./deepseek";
import { detectRestrictedContent, isNewMemberRestricted } from "./newMemberGuard";
import { isNightModeActive } from "./nightMode";
import { isRepeatOffender } from "./reputation";

/** §4.9: which detector produced the verdict — purely additive metadata, never
 * read by applyViolation/reputation.ts. Exists so the §4 shadow scorer
 * (scoring.ts) can tell "the old pipeline didn't model this detector at all"
 * (flood, profanity, premium-ai, restricted-content, night-mode) apart from
 * "the old pipeline looked for spam and found nothing" — `category: "spam"`
 * alone can't distinguish detectSpam from flood from restricted-content. */
export type ModerationSource =
  | "night-mode"
  | "restricted-content"
  | "profanity"
  | "spam-detector"
  | "flood"
  | "premium-ai";

export interface ModerationVerdict {
  category: ViolationCategory;
  reason: string;
  /** When true, apply "warn" regardless of the group's configured action — e.g. a brand-new member's first link. */
  forceWarnOnly: boolean;
  /** False only for night mode's blanket restriction (§15.7 B2): that fires for
   * every member regardless of content, so it isn't evidence of bad behavior
   * and must not feed reputation.ts — everything else defaults true. */
  countsTowardReputation?: boolean;
  source?: ModerationSource;
}

export async function moderateMessage(
  message: Message,
  settings: GroupSettings,
  options: { isEdit?: boolean } = {}
): Promise<ModerationVerdict | null> {
  const text = message.text ?? message.caption ?? "";
  const chatId = settings.chatId;
  const userId = message.from?.id;

  // Ahead of everything else, including the consumeNewMemberFlag read below:
  // during quiet hours every member message goes regardless of content, so
  // burning that one-shot flag on a message we're deleting anyway would rob the
  // member of the leniency on their real first message. forceWarnOnly keeps
  // "you posted at night" from ever escalating into a mute/ban.
  if (isNightModeActive(settings)) {
    return {
      category: "spam",
      reason: "тихий час: сообщения от участников ограничены",
      forceWarnOnly: true,
      countsTowardReputation: false,
      source: "night-mode",
    };
  }

  // Consumed once per message so the softer treatment covers exactly the member's
  // first message, not a rolling time window. Fail open toward "not their first
  // message" (no leniency) on any Redis error, same direction as isRepeatOffender
  // below — losing the leniency is strictly the safer/stricter outcome, unlike an
  // uncaught throw here, which (moderateMessage is awaited outside any try/catch
  // in bot.ts) would abort the whole handler before applyViolation ever runs.
  const isFirstMessage = userId ? await consumeNewMemberFlag(chatId, userId).catch(() => false) : false;

  // §4.5 / §15.7 B2 MVP: a proven repeat offender in THIS chat loses the
  // benefit-of-the-doubt leniency (forceWarnOnly) below — never a stronger
  // action than the group already has configured, just no free pass. Fail
  // open: any Redis error reads as "not a repeat offender".
  //
  // Deliberate, not incidental: stripping forceWarnOnly also lets this
  // verdict start counting toward warnEscalation (applyViolation only skips
  // recordWarn for a *forced* warn, see violations.ts's isForcedWarn) — so a
  // repeat offender who kept triggering leniency-covered violations (e.g.
  // repeated forwards during their new-member restriction window, which was
  // unconditionally forceWarnOnly before this) now both loses the free pass
  // AND starts accumulating real warns from that point on. That's the
  // intended effect of "no more benefit of the doubt," not a side effect to
  // suppress — closes exactly the P1/P7-style gap where soft-touch leniency
  // had no ceiling.
  const isKnownRepeatOffender = userId ? await isRepeatOffender(chatId, userId).catch(() => false) : false;

  // Deliberately ahead of every other check and independent of the
  // profanityFilter/antispam toggles: forwards/links/media from a member still
  // inside their post-join restriction window are a stronger, more specific
  // signal than the general pattern-based checks below, and forceWarnOnly
  // keeps a false positive (a genuine newcomer sharing a link) to a warn at
  // worst rather than a mute/ban.
  if (settings.restrictNewMembersEnabled && userId && (await isNewMemberRestricted(chatId, userId))) {
    const reason = detectRestrictedContent(message);
    if (reason) {
      return { category: "spam", reason, forceWarnOnly: !isKnownRepeatOffender, source: "restricted-content" };
    }
  }

  if (settings.profanityFilter && text) {
    const customWords = await getCustomWords(chatId);
    const result = detectProfanity(text, customWords);
    if (result.matched) {
      const reason = result.source === "custom" ? "запрещённое слово (добавлено вручную)" : "нецензурная лексика";
      return { category: "profanity", reason, forceWarnOnly: false, source: "profanity" };
    }
  }

  if (settings.antispam) {
    const spamResult = detectSpam(message);
    if (spamResult.matched) {
      const forceWarnOnly = isFirstMessage && spamResult.severity === "low" && !isKnownRepeatOffender;
      return { category: "spam", reason: spamResult.reason ?? "спам", forceWarnOnly, source: "spam-detector" };
    }

    // Flood counters model the RATE of message events, not their content — an
    // edit isn't a new event (the user didn't send another message), so it must
    // not feed these counters. Without this guard, someone fixing a typo via
    // "edit" a few times within the flood window gets muted/banned for flooding
    // that never happened, and per-chat "messages" stats get inflated by edits.
    // Content checks above (profanity/spam patterns) still run on edits — an
    // edit into bad content must still be caught.
    if (userId && !options.isEdit) {
      const [userFlood, dupFlood] = await Promise.all([
        checkUserFlood(chatId, userId),
        text ? checkDuplicateFlood(chatId, text) : Promise.resolve(false),
      ]);
      if (userFlood) {
        return {
          category: "spam",
          reason: "флуд: слишком много сообщений подряд",
          forceWarnOnly: false,
          source: "flood",
        };
      }
      if (dupFlood) {
        return { category: "spam", reason: "флуд: повторяющееся сообщение", forceWarnOnly: false, source: "flood" };
      }
    }
  }

  if (settings.premium && text && text.trim().length >= 6) {
    const pool = isProActive(settings) ? "pro" : "free";
    const verdict = await classifyWithDeepseek(text, pool);
    if (verdict?.violation) {
      const forceWarnOnly = isFirstMessage && hasAnyLink(message) && !isKnownRepeatOffender;
      const fallbackReason =
        verdict.category === "profanity"
          ? "нецензурная лексика (ИИ)"
          : verdict.category === "scam"
            ? "похоже на мошенничество (ИИ)"
            : "спам/реклама (ИИ)";
      return {
        category: "premium",
        reason: verdict.reason || fallbackReason,
        forceWarnOnly,
        source: "premium-ai",
      };
    }
  }

  return null;
}

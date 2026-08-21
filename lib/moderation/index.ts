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

export interface ModerationVerdict {
  category: ViolationCategory;
  reason: string;
  /** When true, apply "warn" regardless of the group's configured action — e.g. a brand-new member's first link. */
  forceWarnOnly: boolean;
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
    return { category: "spam", reason: "тихий час: сообщения от участников ограничены", forceWarnOnly: true };
  }

  // Consumed once per message so the softer treatment covers exactly the member's
  // first message, not a rolling time window.
  const isFirstMessage = userId ? await consumeNewMemberFlag(chatId, userId) : false;

  // Deliberately ahead of every other check and independent of the
  // profanityFilter/antispam toggles: forwards/links/media from a member still
  // inside their post-join restriction window are a stronger, more specific
  // signal than the general pattern-based checks below, and forceWarnOnly
  // keeps a false positive (a genuine newcomer sharing a link) to a warn at
  // worst rather than a mute/ban.
  if (settings.restrictNewMembersEnabled && userId && (await isNewMemberRestricted(chatId, userId))) {
    const reason = detectRestrictedContent(message);
    if (reason) {
      return { category: "spam", reason, forceWarnOnly: true };
    }
  }

  if (settings.profanityFilter && text) {
    const customWords = await getCustomWords(chatId);
    const result = detectProfanity(text, customWords);
    if (result.matched) {
      const reason = result.source === "custom" ? "запрещённое слово (добавлено вручную)" : "нецензурная лексика";
      return { category: "profanity", reason, forceWarnOnly: false };
    }
  }

  if (settings.antispam) {
    const spamResult = detectSpam(message);
    if (spamResult.matched) {
      const forceWarnOnly = isFirstMessage && spamResult.severity === "low";
      return { category: "spam", reason: spamResult.reason ?? "спам", forceWarnOnly };
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
        return { category: "spam", reason: "флуд: слишком много сообщений подряд", forceWarnOnly: false };
      }
      if (dupFlood) {
        return { category: "spam", reason: "флуд: повторяющееся сообщение", forceWarnOnly: false };
      }
    }
  }

  if (settings.premium && text && text.trim().length >= 6) {
    const pool = isProActive(settings) ? "pro" : "free";
    const verdict = await classifyWithDeepseek(text, pool);
    if (verdict?.violation) {
      const forceWarnOnly = isFirstMessage && hasAnyLink(message);
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
      };
    }
  }

  return null;
}

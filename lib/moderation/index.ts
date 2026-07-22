import type { Message } from "grammy/types";
import type { GroupSettings, ViolationCategory } from "@/lib/db/types";
import { getCustomWords } from "@/lib/db/customWords";
import { isProActive } from "@/lib/billing/plan";
import { detectProfanity } from "./profanity";
import { detectSpam, hasAnyLink } from "./spam";
import { checkDuplicateFlood, checkUserFlood, consumeNewMemberFlag } from "./flood";
import { classifyWithGroq } from "./groq";

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

  // Consumed once per message so the softer treatment covers exactly the member's
  // first message, not a rolling time window.
  const isFirstMessage = userId ? await consumeNewMemberFlag(chatId, userId) : false;

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
    const verdict = await classifyWithGroq(text, pool);
    if (verdict?.violation) {
      const forceWarnOnly = isFirstMessage && hasAnyLink(message);
      return {
        category: "premium",
        reason: verdict.reason || (verdict.category === "profanity" ? "нецензурная лексика (ИИ)" : "спам/реклама (ИИ)"),
        forceWarnOnly,
      };
    }
  }

  return null;
}

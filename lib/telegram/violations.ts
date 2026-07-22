import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { Message, User } from "grammy/types";
import type { GroupSettings, ViolationAction } from "@/lib/db/types";
import type { ModerationVerdict } from "@/lib/moderation";
import { addJournalEntry } from "@/lib/db/journal";
import { incrementStat } from "@/lib/db/stats";
import { t } from "@/lib/i18n";
import { displayName, mentionHtml } from "./format";
import { propagateBan } from "./federation";

const MUTE_DURATION_SECONDS = 60 * 60; // 1h

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function applyViolation(
  api: Api,
  message: Message,
  settings: GroupSettings,
  verdict: ModerationVerdict
): Promise<void> {
  const chatId = settings.chatId;
  const user = message.from;
  if (!user) return;

  const effectiveAction: ViolationAction =
    verdict.forceWarnOnly && settings.action !== "delete" ? "warn" : settings.action;

  await api.deleteMessage(chatId, message.message_id).catch((err) => {
    if (!(err instanceof GrammyError)) throw err;
  });

  const text = message.text ?? message.caption ?? "";

  await Promise.all([
    logToJournal(chatId, message, user, verdict, effectiveAction, text),
    incrementStat(chatId, verdict.category),
    settings.logChannelId
      ? forwardToLogChannel(api, settings.logChannelId, chatId, user, verdict, effectiveAction, text).catch(() => {})
      : Promise.resolve(),
  ]);

  await notifyChat(api, chatId, user, settings, verdict, effectiveAction);

  if (effectiveAction === "ban" && settings.federationEnabled) {
    await propagateBan(api, chatId, user, verdict.reason).catch(() => {});
  }
}

async function logToJournal(
  chatId: number,
  message: Message,
  user: User,
  verdict: ModerationVerdict,
  action: ViolationAction,
  text: string
) {
  await addJournalEntry({
    id: randomId(),
    chatId,
    messageId: message.message_id,
    userId: user.id,
    username: user.username ?? null,
    displayName: displayName(user),
    text: text.slice(0, 2000),
    category: verdict.category,
    reason: verdict.reason,
    action,
    timestamp: Date.now(),
    restored: false,
  });
}

async function forwardToLogChannel(
  api: Api,
  logChannelId: number,
  chatId: number,
  user: User,
  verdict: ModerationVerdict,
  action: ViolationAction,
  text: string
) {
  const lines = [
    `🗑 Удалено в чате ${chatId}`,
    `Пользователь: ${displayName(user)} (id${user.id})`,
    `Категория: ${verdict.category}`,
    `Причина: ${verdict.reason}`,
    `Действие: ${action}`,
    text ? `Текст: ${text.slice(0, 500)}` : undefined,
  ].filter(Boolean);
  await api.sendMessage(logChannelId, lines.join("\n"));
}

async function notifyChat(
  api: Api,
  chatId: number,
  user: User,
  settings: GroupSettings,
  verdict: ModerationVerdict,
  action: ViolationAction
) {
  const lang = settings.lang;
  const mention = mentionHtml(user);

  if (action === "delete") return; // silent removal, no extra chat noise

  if (action === "warn") {
    const key = verdict.forceWarnOnly ? "bot.firstMessageLinkWarn" : "bot.warnedUser";
    await api.sendMessage(chatId, t(lang, key, { user: mention, reason: verdict.reason }), {
      parse_mode: "HTML",
    });
    return;
  }

  if (action === "mute") {
    await api
      .restrictChatMember(
        chatId,
        user.id,
        {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
        },
        { until_date: Math.floor(Date.now() / 1000) + MUTE_DURATION_SECONDS }
      )
      .catch(() => {});
    await api.sendMessage(chatId, t(lang, "bot.mutedUser", { user: mention, reason: verdict.reason }), {
      parse_mode: "HTML",
    });
    return;
  }

  if (action === "ban") {
    await api.banChatMember(chatId, user.id).catch(() => {});
    await api.sendMessage(chatId, t(lang, "bot.bannedUser", { user: mention, reason: verdict.reason }), {
      parse_mode: "HTML",
    });
  }
}

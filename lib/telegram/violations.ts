import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { after } from "next/server";
import type { Message, User } from "grammy/types";
import type { GroupSettings, ViolationAction } from "@/lib/db/types";
import type { Lang } from "@/lib/i18n";
import type { ModerationVerdict } from "@/lib/moderation";
import { addJournalEntry } from "@/lib/db/journal";
import { incrementStat } from "@/lib/db/stats";
import { recordReactionTime, type ReactionPath } from "@/lib/db/reactionStats";
import { clearPendingNotice, getPendingNotice, setPendingNotice } from "@/lib/db/autoNotice";
import { t } from "@/lib/i18n";
import { displayName, mentionHtml } from "./format";
import { propagateBan } from "./federation";
import { clearWarns, recordWarn } from "@/lib/moderation/warns";
import { collectSpamSignals, countedSignals, scoreSignals } from "@/lib/moderation/scoring";
import { getAllowlist } from "@/lib/db/allowlist";
import { startVoteBan } from "./voteban";

/** Best-effort limit for the visible (wall-clock) reaction sample — matches
 * reactionStats.ts's own plausibility window. */
const VISIBLE_SANE_MAX_MS = 10 * 60 * 1000;

export interface ReactionTiming {
  /** performance.now() captured at webhook-handler entry (bot.ts). */
  receivedAt: number;
  /** Message send/edit time in wall-clock ms. */
  sentAtMs: number;
}

/** " · ⚡ 0.4 с" appended to a warn/mute/ban notice (and the delete notice).
 * Empty when there's no usable measurement. */
function reactionSuffix(lang: Lang, reactionMs: number | null): string {
  if (reactionMs === null || !Number.isFinite(reactionMs) || reactionMs < 0) return "";
  return " " + t(lang, "bot.reactionSuffix", { seconds: (reactionMs / 1000).toFixed(1) });
}

const MUTE_DURATION_SECONDS = 60 * 60; // 1h

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function applyViolation(
  api: Api,
  message: Message,
  settings: GroupSettings,
  verdict: ModerationVerdict,
  timing?: ReactionTiming
): Promise<void> {
  const chatId = settings.chatId;
  const user = message.from;
  if (!user) return;

  // Deleting the offending message doesn't depend on warn/escalation state,
  // so it goes first and un-delayed by the Redis round trip below — and if
  // it throws (a real, unexpected failure; GrammyError is the only kind
  // suppressed), it aborts before any warn-count mutation happens, instead of
  // after one, which would otherwise leave a warn recorded/cleared with no
  // corresponding punishment or journal entry to show for it.
  let deleted = true;
  await api.deleteMessage(chatId, message.message_id).catch((err) => {
    if (!(err instanceof GrammyError)) throw err;
    // Bot lacks delete rights, or the message is already gone — not a real
    // deletion, so it must not feed the reaction-time average below.
    deleted = false;
  });

  // "Время реакции" finalized: handler entry → delete confirmed (proc, the
  // number we optimise) and message-sent → delete confirmed (visible, what a
  // member perceives). Persisted via after() so measuring never inflates the
  // thing measured; the inline number feeds notifyChat.
  let reactionMs: number | null = null;
  if (deleted && timing) {
    const procMs = performance.now() - timing.receivedAt;
    const visibleMs = Date.now() - timing.sentAtMs;
    const path: ReactionPath = verdict.source === "premium-ai" ? "ai" : "base";
    after(() => recordReactionTime(chatId, { path, procMs, visibleMs }).catch(() => {}));
    reactionMs = visibleMs >= 0 && visibleMs <= VISIBLE_SANE_MAX_MS ? Math.max(visibleMs, procMs) : procMs;
  }

  // A forced/leniency warn (new member's first message, first link) must
  // never count toward escalation — it's deliberately "benefit of the
  // doubt", not a real strike against a repeat offender.
  const isForcedWarn = verdict.forceWarnOnly && settings.action !== "delete";
  let effectiveAction: ViolationAction = isForcedWarn ? "warn" : settings.action;

  let warnCount: number | null = null;
  let escalated = false;
  if (effectiveAction === "warn" && !isForcedWarn && settings.warnEscalationEnabled) {
    warnCount = await recordWarn(chatId, user.id, settings.warnTtlDays).catch(() => null);
    if (warnCount !== null && warnCount >= settings.warnLimit) {
      effectiveAction = settings.warnAction;
      escalated = true;
      await clearWarns(chatId, user.id).catch(() => {});
    }
  }

  const text = message.text ?? message.caption ?? "";

  await Promise.all([
    logToJournal(chatId, message, user, verdict, effectiveAction, text, escalated),
    incrementStat(chatId, verdict.category),
    settings.logChannelId
      ? forwardToLogChannel(api, settings.logChannelId, chatId, user, verdict, effectiveAction, text).catch(() => {})
      : Promise.resolve(),
  ]);

  await notifyChat(api, chatId, user, settings, verdict, effectiveAction, { warnCount, escalated }, reactionMs);

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
  text: string,
  escalated: boolean
) {
  // §10.1.1 "почему сработало": explanatory re-derivation only — see
  // JournalEntry.score. Pure/sync, but wrapped so an unexpected throw on some
  // message shape can't take down the entry (and the stat increment it shares
  // a Promise.all with in applyViolation).
  let score: number | undefined;
  let signals: { name: string; weight: number }[] = [];
  // Reuse the allowlist moderateMessage already read for this verdict; only
  // fall back to a fresh GET for verdicts decided before that read (night-mode,
  // restricted-content) — those re-derive to an empty signal list anyway.
  const allowlist = verdict.contentAllowlist ?? (await getAllowlist(chatId).catch(() => []));
  try {
    const collected = collectSpamSignals(message, allowlist);
    score = scoreSignals(collected, 0, false).score;
    signals = countedSignals(collected).map((s) => ({ name: s.name, weight: s.weight }));
  } catch {
    score = undefined;
    signals = [];
  }

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
    escalated,
    timestamp: Date.now(),
    restored: false,
    score,
    signals,
    source: verdict.source ?? null,
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
  action: ViolationAction,
  escalation: { warnCount: number | null; escalated: boolean },
  reactionMs: number | null
) {
  const lang = settings.lang;
  const mention = mentionHtml(user);
  const reaction = reactionSuffix(lang, reactionMs);
  const escalationSuffix = escalation.escalated
    ? " " + t(lang, "bot.warnEscalated", { action: t(lang, `bot.actionNames.${action}`) })
    : "";

  if (action === "delete") {
    // Silent by design. The opt-in deleteNotice setting posts one short public
    // notice that replaces itself on the next moderation event
    // (lib/db/autoNotice.ts) — at most one is ever visible. Runs in after() so
    // none of its round trips (Redis GET, delete, send, Redis SET) land on the
    // awaited webhook path: the offending message is already gone and nothing
    // downstream reads the notice — most relevant during a raid, when
    // deleteNotice is most likely on and every added RTT would compound.
    if (!settings.deleteNotice) return;
    after(async () => {
      const prev = await getPendingNotice(chatId).catch(() => null);
      if (prev) await api.deleteMessage(chatId, prev).catch(() => {});
      const sent = await api
        .sendMessage(chatId, t(lang, "bot.deleteNoticePublic", { reason: verdict.reason }) + reaction)
        .catch(() => null);
      if (sent) await setPendingNotice(chatId, sent.message_id).catch(() => {});
      else await clearPendingNotice(chatId).catch(() => {});
    });
    return;
  }

  if (action === "warn") {
    // One generic, reason-templated message for every warn — forceWarnOnly now
    // covers several unrelated leniency cases (new member link, restricted-window
    // content, night mode), so a case-specific canned string here would show the
    // wrong scenario's wording for the others.
    let text = t(lang, "bot.warnedUser", { user: mention, reason: verdict.reason });
    if (!verdict.forceWarnOnly && settings.warnEscalationEnabled && escalation.warnCount !== null) {
      text += " " + t(lang, "bot.warnCount", { count: escalation.warnCount, limit: settings.warnLimit });
    }
    await api.sendMessage(chatId, text + reaction, { parse_mode: "HTML" });
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
    const sent = await api.sendMessage(
      chatId,
      t(lang, "bot.mutedUser", { user: mention, reason: verdict.reason }) + escalationSuffix + reaction,
      { parse_mode: "HTML", reply_markup: voteBanKeyboard(lang, chatId, user.id, settings.voteBanThreshold) }
    );
    await startVoteBan(chatId, user.id, sent.message_id).catch(() => {});
    return;
  }

  if (action === "ban") {
    await api.banChatMember(chatId, user.id).catch(() => {});
    // A federated ban is a cross-group decision (see propagateBan below) — a
    // single group's local vote must never be able to undo that, so no button.
    const voteEligible = !settings.federationEnabled;
    const sent = await api.sendMessage(
      chatId,
      t(lang, "bot.bannedUser", { user: mention, reason: verdict.reason }) + escalationSuffix + reaction,
      {
        parse_mode: "HTML",
        reply_markup: voteEligible ? voteBanKeyboard(lang, chatId, user.id, settings.voteBanThreshold) : undefined,
      }
    );
    if (voteEligible) await startVoteBan(chatId, user.id, sent.message_id).catch(() => {});
  }
}

function voteBanKeyboard(lang: GroupSettings["lang"], chatId: number, userId: number, threshold: number) {
  return {
    inline_keyboard: [
      [
        {
          text: t(lang, "bot.voteBanButton", { count: 0, threshold }),
          callback_data: `vb:${chatId}:${userId}`,
        },
      ],
    ],
  };
}

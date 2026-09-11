import type { Lang } from "@/lib/i18n";

export type ViolationAction = "delete" | "warn" | "mute" | "ban";

export type ViolationCategory = "profanity" | "spam" | "premium";

/** Finer-grained breakdown of *why* a violation fired, additive to (never a
 * replacement for) ViolationCategory — a monthly digest saying "12 удалено"
 * is much less useful than "8 реклама, 3 скам, 1 опасный файл", but the
 * existing category buckets stay exactly as coarse as today/7d/30d and the
 * owner overview already expect. See lib/moderation/reasonTags.ts for how a
 * verdict maps down to one of these. */
export type ReasonTag =
  | "profanity"
  | "scam"
  | "apk"
  | "phishing_link"
  | "ads"
  | "ai"
  | "flood"
  | "cas"
  | "raid"
  | "globalban"
  | "other";

export type PlanTier = "free" | "pro";

export type CaptchaType = "button" | "math" | "rules";

export interface GroupSettings {
  chatId: number;
  title: string;
  profanityFilter: boolean;
  antispam: boolean;
  premium: boolean;
  action: ViolationAction;
  logChannelId: number | null;
  lang: Lang;
  createdAt: number;
  /** Off by default — tucked into an "Advanced" section in the Mini App, not the main flow. */
  captchaEnabled: boolean;
  /** "button" (one-tap) / "math" (pick the correct sum) are Pro-gated like the
   * rest of captchaEnabled; "rules" (agree-to-rules gate, §15.3) is deliberately
   * free — closer in spirit to welcomeMessage than to the human-check types —
   * see the captchaType === "rules" carve-outs in commands.ts and the PATCH route. */
  captchaType: CaptchaType;
  /** Rules text shown (HTML-escaped) before the "I agree" button when
   * captchaType is "rules". Null falls back to a generic prompt — enabling
   * the rules-gate is never blocked on this being set first. */
  rulesText: string | null;
  /** Seconds before an unanswered captcha expires and the member is kicked. */
  captchaTimeoutSeconds: number;
  /** Mass-join detection; forces captcha verification on new members during a detected raid. Same eligibility gate as captcha. */
  antiraidEnabled: boolean;
  /** Same raid detection, but on by default (not opt-in) — protection for
   * groups that never touched `antiraidEnabled`. Explicitly turning
   * `antiraidEnabled` off also clears this (see updateGroupSettings), so
   * "off" in the UI means fully off, not silently still-protected. */
  antiraidAuto: boolean;
  /** Opt-in ban sharing: when true, a bot-triggered ban here also bans the
   * same user in every OTHER group this group's current admins also manage
   * that has this on too. Trust boundary is shared admin identity — never
   * spreads to a group with no admin in common with this one. */
  federationEnabled: boolean;
  /** Checks new joiners against CAS (cas.chat) — a free shared database of
   * known spam/scam accounts — and bans them on join, before they can post.
   * Free for everyone (no DeepSeek/size cost), on by default, opt-out. */
  casCheckEnabled: boolean;
  /** Off by default: existing groups using action="warn" get exactly the
   * behavior they always had unless they explicitly opt in — auto-escalating
   * to mute/ban after N warns is a real behavior change (a false positive
   * costs a real ban, not just a benign captcha click), so it must never turn
   * on silently. */
  warnEscalationEnabled: boolean;
  /** Warns within `warnTtlDays` before escalating to `warnAction`. */
  warnLimit: number;
  warnAction: "mute" | "ban";
  warnTtlDays: number;
  /** §15.4: unique chat-member clicks needed on the "vote to lift" button
   * under a mute/ban notice before it's auto-reversed. Never offered for
   * federated bans (see notifyChat) — a local vote can't undo a cross-group
   * decision. */
  voteBanThreshold: number;
  welcomeEnabled: boolean;
  /** May contain the literal placeholder "{user}", substituted with an HTML mention on send. */
  welcomeMessage: string | null;
  /** Deletes Telegram's own "X joined/added/left the group" service messages.
   * On by default — purely cosmetic chat cleanup, no moderation tradeoff. */
  deleteServiceMessages: boolean;
  /** Off by default: when the action is a silent "delete", also post one short
   * public notice ("сообщение удалено — не размещайте рекламу", with the
   * reaction time). The notice replaces itself on the next moderation event
   * (see lib/db/autoNotice.ts), so at most one is ever visible. Kept opt-in
   * because turning it on changes outward behaviour in the chat — the delete
   * action is silent by design otherwise. */
  deleteNotice: boolean;
  /** Off by default: deletes forwarded messages, links, and media/stickers from
   * a member for their first `restrictNewMembersMinutes` minutes after joining —
   * the dominant vector for freshly-joined spam/scam accounts (ad forwards,
   * phishing links) posted before any content pattern has a chance to repeat. */
  restrictNewMembersEnabled: boolean;
  restrictNewMembersMinutes: number;
  /** Quiet hours, as UTC hours (0-23) so the window never shifts with a
   * server/member timezone; start > end simply wraps past midnight. */
  nightModeEnabled: boolean;
  nightModeStartHour: number;
  nightModeEndHour: number;
  plan: PlanTier;
  /** Unix ms. Null unless a Stars subscription has ever been active for this group. */
  planExpiresAt: number | null;
  /** GROWTH.md §2.5: allows ONE inline "🛡 Защитить свой чат" button under a
   * warn/mute/ban notice — the bot's only in-chat growth surface. On by
   * default, but only ever rendered for groups without an active Pro plan
   * (see notifyChat): paying groups buy silence, among other things. */
  attributionEnabled: boolean;
  /** Telegram user id of whoever's `?start=ref_<id>` link led to this group
   * being added (GROWTH.md §2.4). Attribution/audit only — the reward payout
   * reads lib/db/referrals.ts, never this field, so a wrong value here can't
   * grant anyone anything. */
  referredBy: number | null;
  /** Free for everyone, on by default (see MONTHLYDIGEST scope decision) —
   * a monthly "what got removed" summary posted at the group's own best hour. */
  monthlyDigestEnabled: boolean;
  /** "YYYY-MM" (UTC) of the last month a digest was actually sent, or null.
   * The idempotency guard for the hourly cron: without it, a group whose
   * digest hour/day match would get re-sent every hour for the rest of that
   * hour's minute-0 window, and again on any redeploy/retry within the month. */
  lastDigestSentMonth: string | null;
}

export const DEFAULT_GROUP_SETTINGS: Omit<GroupSettings, "chatId" | "title" | "createdAt" | "lang"> = {
  profanityFilter: true,
  antispam: true,
  premium: false,
  action: "delete",
  logChannelId: null,
  captchaEnabled: false,
  captchaType: "button",
  rulesText: null,
  captchaTimeoutSeconds: 120,
  antiraidEnabled: false,
  antiraidAuto: true,
  federationEnabled: false,
  casCheckEnabled: true,
  warnEscalationEnabled: false,
  warnLimit: 3,
  warnAction: "mute",
  warnTtlDays: 7,
  voteBanThreshold: 3,
  welcomeEnabled: false,
  welcomeMessage: null,
  deleteServiceMessages: true,
  deleteNotice: false,
  restrictNewMembersEnabled: false,
  restrictNewMembersMinutes: 10,
  nightModeEnabled: false,
  // Compared against UTC hours (nightMode.ts), not local time. 18-2 UTC ==
  // 23:00-07:00 in Tashkent (UTC+5, no DST) — the timezone most groups are in.
  nightModeStartHour: 18,
  nightModeEndHour: 2,
  plan: "free",
  planExpiresAt: null,
  attributionEnabled: true,
  referredBy: null,
  monthlyDigestEnabled: true,
  lastDigestSentMonth: null,
};

export interface JournalEntry {
  id: string;
  chatId: number;
  messageId: number;
  userId: number;
  username: string | null;
  displayName: string;
  text: string;
  category: ViolationCategory;
  reason: string;
  action: ViolationAction;
  /** True when `action` was reached via warn escalation rather than the
   * group's configured `action`/`warnAction` directly — lets the journal show
   * "auto-escalated" instead of implying the admin configured this action for
   * this category outright. */
  escalated: boolean;
  timestamp: number;
  restored: boolean;
  /** §10.1.1 "почему сработало": a content-only re-run of the v2 spam scorer
   * (scoring.ts `collectSpamSignals` + `scoreSignals`) done at journal-write
   * time, purely to explain the entry. It is NOT what produced `action` (the
   * live pipeline is rule-based, not scored) and NOT the same number the
   * shadow screen shows — reputation/new-account modifiers are deliberately
   * excluded here (same rationale as corpusCollector: a feature of the message
   * alone). Empty `signals` is normal for profanity/flood/night-mode/
   * restricted-content verdicts, which `collectSpamSignals` doesn't model.
   * All three absent on entries written before this was added. */
  score?: number;
  signals?: { name: string; weight: number }[];
  /** Which `moderateMessage` detector produced the verdict: "spam-detector",
   * "profanity", "flood", "premium-ai", "restricted-content", "night-mode". */
  source?: string | null;
}

/**
 * A message a member sent to the bot in private, asking to reach the group's
 * admin(s) — the "Написать администратору" flow (see lib/db/appeals.ts,
 * lib/telegram/commands.ts). Never causes an action by itself; an admin
 * reviews it in the Mini App and acts (unban, or just dismiss) by hand.
 */
export interface AppealEntry {
  id: string;
  chatId: number;
  userId: number;
  username: string | null;
  displayName: string;
  text: string;
  createdAt: number;
  /**
   * "offer_sent": an admin priced a paid unban and the Stars invoice was
   * delivered to the appellant's private chat — still open until they pay
   * (→ "resolved", lib/telegram/bot.ts successful_payment) or an admin
   * dismisses it directly.
   * "payment_failed": the Stars payment succeeded but `unbanChatMember`
   * itself failed (bot lost ban rights, chat gone, etc.) — Telegram already
   * took the payer's money, so this MUST surface distinctly in the Mini App
   * rather than silently reading as "resolved" when the user is still
   * banned. Needs a human to sort out manually.
   */
  status: "open" | "offer_sent" | "resolved" | "dismissed" | "payment_failed";
  /** Set when an admin offers a paid unban (§ "Предложить платный разбан").
   * Never set by the bot itself — always a specific admin's per-case price,
   * never a default the bot suggests. */
  offerStars?: number;
  offeredAt?: number;
}

export interface StatsBucket {
  total: number;
  profanity: number;
  spam: number;
  premium: number;
}

export interface AdminGroupSummary {
  chatId: number;
  title: string;
  premium: boolean;
  profanityFilter: boolean;
  antispam: boolean;
  hasPermissionIssue: boolean;
  plan: PlanTier;
  isPro: boolean;
}

/** A bot-owner-issued ban that applies across every group the bot manages,
 * not just one — see lib/telegram/globalBan.ts. */
export interface GlobalBanEntry {
  userId: number;
  reason: string;
  bannedAt: number;
  bannedBy: number;
}

/** One row of the bot-owner's cross-group overview (app/owner). */
export interface OwnerGroupSummary {
  chatId: number;
  title: string;
  plan: PlanTier;
  isPro: boolean;
  planExpiresAt: number | null;
  violationsToday: number;
  joinsToday: number;
  createdAt: number;
}

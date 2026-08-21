import type { Lang } from "@/lib/i18n";

export type ViolationAction = "delete" | "warn" | "mute" | "ban";

export type ViolationCategory = "profanity" | "spam" | "premium";

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
  welcomeEnabled: boolean;
  /** May contain the literal placeholder "{user}", substituted with an HTML mention on send. */
  welcomeMessage: string | null;
  /** Deletes Telegram's own "X joined/added/left the group" service messages.
   * On by default — purely cosmetic chat cleanup, no moderation tradeoff. */
  deleteServiceMessages: boolean;
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
  welcomeEnabled: false,
  welcomeMessage: null,
  deleteServiceMessages: true,
  restrictNewMembersEnabled: false,
  restrictNewMembersMinutes: 10,
  nightModeEnabled: false,
  nightModeStartHour: 23,
  nightModeEndHour: 7,
  plan: "free",
  planExpiresAt: null,
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

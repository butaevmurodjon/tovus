import type { Lang } from "@/lib/i18n";

export type ViolationAction = "delete" | "warn" | "mute" | "ban";

export type ViolationCategory = "profanity" | "spam" | "premium";

export type PlanTier = "free" | "pro";

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
  welcomeEnabled: boolean;
  /** May contain the literal placeholder "{user}", substituted with an HTML mention on send. */
  welcomeMessage: string | null;
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
  antiraidEnabled: false,
  antiraidAuto: true,
  federationEnabled: false,
  welcomeEnabled: false,
  welcomeMessage: null,
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

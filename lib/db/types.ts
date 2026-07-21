import type { Lang } from "@/lib/i18n";

export type ViolationAction = "delete" | "warn" | "mute" | "ban";

export type ViolationCategory = "profanity" | "spam" | "premium";

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
  welcomeEnabled: boolean;
  /** May contain the literal placeholder "{user}", substituted with an HTML mention on send. */
  welcomeMessage: string | null;
}

export const DEFAULT_GROUP_SETTINGS: Omit<GroupSettings, "chatId" | "title" | "createdAt" | "lang"> = {
  profanityFilter: true,
  antispam: true,
  premium: false,
  action: "delete",
  logChannelId: null,
  captchaEnabled: false,
  welcomeEnabled: false,
  welcomeMessage: null,
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
}

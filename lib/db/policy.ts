import { getRedis } from "./redis";
import type { GroupSettings } from "./types";

const POLICY_KEY = "bot:policy";

/**
 * Fields eligible for a bot-wide default policy (FAANG-audit §5, 2026-09-15
 * — built after "не бойся рисков"; see lib/db/groups.ts for how this
 * actually resolves against a group's own settings). Pure moderation
 * behavior only — deliberately excludes:
 *  - identity: chatId, title, lang, createdAt
 *  - billing: plan, planExpiresAt, referredBy
 *  - free-text / per-group content: welcomeMessage, rulesText, logChannelId,
 *    ownerChannelId, ownerChannelUsername
 *  - owner-only per-group flags that were never "policy" in the first
 *    place: dailySummaryOwnerAllowed, lastDailySummarySentDate,
 *    lastDigestSentMonth, promoChannelOptIn, attributionEnabled
 * Centrally overriding any of those would be a straight bug (silently
 * rewriting a group's billing state or channel config), not a feature — so
 * they can never reach here even if a caller tries.
 */
export const POLICY_ELIGIBLE_KEYS = [
  "profanityFilter",
  "antispam",
  "premium",
  "action",
  "captchaEnabled",
  "captchaType",
  "captchaTimeoutSeconds",
  "antiraidEnabled",
  "antiraidAuto",
  "federationEnabled",
  "casCheckEnabled",
  "warnEscalationEnabled",
  "warnLimit",
  "warnAction",
  "warnTtlDays",
  "voteBanThreshold",
  "deleteServiceMessages",
  "deleteNotice",
  "restrictNewMembersEnabled",
  "restrictNewMembersMinutes",
  "nightModeEnabled",
  "nightModeStartHour",
  "nightModeEndHour",
  "monthlyDigestEnabled",
  "joinRequestCaptchaEnabled",
  "blockUnauthorizedBots",
  "strictContentRules",
  "purgeMessagesOnBan",
  "adminTaggerEnabled",
  "blockNoUsername",
  "blockNoPhoto",
  "premiumJoinFilter",
  "minAccountAgeDays",
  "reactionSpamEnabled",
  "ocrEnabled",
  "antiFirstCommentEnabled",
] as const satisfies readonly (keyof GroupSettings)[];

export type PolicyKey = (typeof POLICY_ELIGIBLE_KEYS)[number];
export type Policy = Partial<Pick<GroupSettings, PolicyKey>>;

const ELIGIBLE_SET = new Set<string>(POLICY_ELIGIBLE_KEYS);

export function isPolicyEligible(key: string): key is PolicyKey {
  return ELIGIBLE_SET.has(key);
}

/** Defensive filter so a stray or since-removed key sitting in storage can
 * never leak into settings resolution — the allowlist above is the only
 * source of truth for what policy is allowed to touch, not whatever
 * happens to be in Redis. */
function sanitize(raw: Record<string, unknown> | null): Policy {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const key of POLICY_ELIGIBLE_KEYS) {
    if (key in raw) out[key] = raw[key];
  }
  return out as Policy;
}

export async function getPolicy(): Promise<Policy> {
  const raw = await getRedis().get<Record<string, unknown>>(POLICY_KEY);
  return sanitize(raw);
}

export async function setPolicyField<K extends PolicyKey>(key: K, value: GroupSettings[K]): Promise<Policy> {
  const current = await getPolicy();
  const next = { ...current, [key]: value };
  await getRedis().set(POLICY_KEY, next);
  return next;
}

export async function clearPolicyField(key: PolicyKey): Promise<Policy> {
  const current = await getPolicy();
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  await getRedis().set(POLICY_KEY, next);
  return next;
}

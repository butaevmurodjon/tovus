import type { GroupSettings } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";

/**
 * Combot's own public free tier is "free under 200 members" — we use that as
 * our reference anchor rather than inventing a number from nothing. Below this,
 * a group gets Pro-tier perks (captcha, antiraid) for free as a grace/trial;
 * above it, the group needs an active subscription.
 */
export const FREE_TIER_MAX_MEMBERS = 200;

/**
 * ~$5/mo at typical Telegram Stars pricing — the same monthly anchor Combot
 * charges. Stars-to-USD varies by region/purchase tier and Telegram/store cuts,
 * so this is an approximate anchor, not a precise conversion — adjust freely.
 */
export const PRO_PRICE_STARS = 349;

/** The only value the Bot API currently accepts for an XTR subscription_period. */
export const PRO_SUBSCRIPTION_PERIOD_SECONDS = 2592000; // 30 days

type PlanFields = Pick<GroupSettings, "plan" | "planExpiresAt">;

export function isProActive(settings: PlanFields): boolean {
  if (settings.plan !== "pro") return false;
  if (!settings.planExpiresAt) return false;
  return settings.planExpiresAt > Date.now();
}

/**
 * `null` means the member-count lookup is currently unknown/failing, not that the
 * group is small — treating unknown as "doesn't require Pro" would fail OPEN,
 * silently giving paid features to a group of any size for as long as the lookup
 * stays broken. Failing closed here costs a small free-tier group a temporary
 * captcha/antiraid outage during an infra hiccup, which is a far cheaper mistake
 * than an unbounded entitlement bypass on a paid gate.
 */
export function requiresProForSize(memberCount: number | null): boolean {
  return memberCount === null || memberCount > FREE_TIER_MAX_MEMBERS;
}

/**
 * Eligibility for Pro-only *features* (captcha, antiraid): either an active paid
 * subscription, or small enough to fall under the free-grace member threshold.
 * Not used for Groq quota routing — that's `isProActive` alone, see groq.ts.
 */
export function canUseProFeature(settings: PlanFields, memberCount: number | null): boolean {
  return isProActive(settings) || !requiresProForSize(memberCount);
}

/** Shared so the bot (Node) and Mini App (browser) render the exact same date, not four
 * independently-maintained copies of the same uz-UZ/ru-RU branch. */
export function formatPlanDate(expiresAtMs: number | null | undefined, lang: Lang): string {
  if (!expiresAtMs) return "—";
  return new Date(expiresAtMs).toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU");
}

/** The single-line "PRO до {date}" / "Базовый" label used by the /settings, /plan, and payment-confirmation bot messages. */
export function formatPlanLabel(settings: PlanFields, lang: Lang): string {
  return isProActive(settings)
    ? t(lang, "bot.planPro", { date: formatPlanDate(settings.planExpiresAt, lang) })
    : t(lang, "bot.planFree");
}

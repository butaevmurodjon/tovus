import type { GroupSettings } from "@/lib/db/types";

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

export function requiresProForSize(memberCount: number | null): boolean {
  return memberCount !== null && memberCount > FREE_TIER_MAX_MEMBERS;
}

/**
 * Eligibility for Pro-only *features* (captcha, antiraid): either an active paid
 * subscription, or small enough to fall under the free-grace member threshold.
 * Not used for Groq quota routing — that's `isProActive` alone, see groq.ts.
 */
export function canUseProFeature(settings: PlanFields, memberCount: number | null): boolean {
  return isProActive(settings) || !requiresProForSize(memberCount);
}

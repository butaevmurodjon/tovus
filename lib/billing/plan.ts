import type { GroupSettings } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";

/**
 * MONETIZATION.md §2/§5 Phase 1: captcha and antiraid are Free for every group
 * regardless of size now (Rose gives them away too — paywalling them lost the
 * "what do I even pay for" comparison). This threshold survives only for the
 * features still gated PRO with no size carve-out in the tariff table —
 * `federationEnabled` and the active-hours analytics — as the pre-existing
 * small-group grace: a group at or under this size gets those free too, same
 * as before the re-cut. Combot's own public free tier ("free under 200
 * members") is the reference anchor.
 */
export const FREE_TIER_MAX_MEMBERS = 200;

/**
 * MONETIZATION.md §5 Phase 1 re-cut, cheaper ladder (owner decision
 * 2026-09-11): PRO dropped from 349 to 199 ⭐/mo to stop losing impulse buys to
 * Group Help/ChatKeeper. Stars-to-USD varies by region/purchase tier and
 * Telegram/store cuts, so this is an approximate anchor, not a precise
 * conversion — adjust freely.
 */
export const PRO_PRICE_STARS = 199;

/**
 * PRO Lite — one-time unlock (no `subscription_period`), MONETIZATION.md §2.
 * Not yet wired to a purchase flow (Phase 2); constant reserved so the number
 * lives in one place once that invoice ships.
 */
export const PRO_LITE_PRICE_STARS = 129;

/**
 * PRO annual — one-time invoice (Stars subscriptions only support a 30-day
 * period, so a year is a plain one-off purchase, not a recurring one),
 * MONETIZATION.md §2/§5. ~17% cheaper than 12× the monthly price. Not yet
 * wired to a purchase flow (Phase 2).
 */
export const PRO_YEAR_PRICE_STARS = 1990;

/** Agency/white-label clone, one-time. Not yet wired to a purchase flow (Phase 4). */
export const WHITE_LABEL_PRICE_STARS = 500;

/** The only value the Bot API currently accepts for an XTR subscription_period. */
export const PRO_SUBSCRIPTION_PERIOD_SECONDS = 2592000; // 30 days

/**
 * Bounds for the per-case price an admin sets on a paid unban (2026-09-12
 * "написать администратору" follow-up) — kept here, not in
 * lib/telegram/payments.ts, so the Mini App page (client-side, must not pull
 * in server-only Redis/grammy code) can import them directly.
 * `MAX_UNBAN_PRICE_STARS` is Telegram's own documented cap for a single Stars
 * (XTR) invoice's total price — createInvoiceLink rejects anything above it.
 */
export const MIN_UNBAN_PRICE_STARS = 1;
export const MAX_UNBAN_PRICE_STARS = 2500;

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
 * Eligibility for the remaining size-gated Pro-only *features* — federation
 * (ban-list sharing) and active-hours analytics, per MONETIZATION.md §2. Either
 * an active paid subscription, or small enough to fall under the free-grace
 * member threshold. Captcha and antiraid are no longer gated by this (Phase 1
 * re-cut) — they're unconditionally Free, see bot.ts/commands.ts.
 * Not used for DeepSeek quota routing — that's `isProActive` alone, see deepseek.ts.
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

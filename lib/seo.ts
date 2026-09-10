/**
 * Single source of truth for the public-facing site identity.
 *
 * Both values are deliberately isolated here because they are still open
 * owner decisions (GROWTH.md §6): the final bot/brand name and the custom
 * domain. Renaming the product or moving off `*.vercel.app` should be a
 * one-line change in this file (plus the `NEXT_PUBLIC_SITE_URL` env var),
 * not a grep across the app.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tg-atispam.vercel.app";

/** Brand shown in <title> templates, OpenGraph siteName and the OG image. */
export const SITE_NAME = "TOVUS | Антиспам";

/**
 * One-line RU tagline. Rendered in three places at once — the landing hero,
 * the footer and the OG image (app/opengraph-image.tsx) — so it has to stay
 * short enough to survive at 32px on a 1200×630 canvas.
 *
 * DIVERGES from GROWTH.md §1.2 on purpose: «скама» was added because the bot
 * genuinely ships anti-scam (fake bank .apk, phishing links, CAS known-scammer
 * lookups, the DeepSeek scam class) and §1.2 predates that copy. The wording
 * matches the bot's own strings in lib/i18n/dictionaries/ru.json
 * («Чищу чаты от мата, рекламы, скама и вирусных .apk»). GROWTH.md itself was
 * not edited — reconcile §1.2 there when convenient.
 */
export const SITE_TAGLINE =
  "Чистит чат от мата, рекламы, скама и вирусных .apk — по-русски и по-узбекски.";

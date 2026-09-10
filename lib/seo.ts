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

/** One-line RU tagline, kept in sync with GROWTH.md §1.2. */
export const SITE_TAGLINE = "Чистит чат от мата, рекламы и вирусных .apk — по-русски и по-узбекски.";

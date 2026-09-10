import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

/**
 * `удаление .apk` was shortened to `.apk` to make room for `антискам` without
 * lengthening the title: 62 characters against the previous 61, still inside
 * the ~60–65 mark where Google and Yandex start truncating Cyrillic titles.
 * Keep any future edit a SWAP, not an append.
 */
const TITLE_DEFAULT = "Бот-модератор Telegram: антиспам, антискам, фильтр мата и .apk";
const DESCRIPTION =
  "Антиспам-бот для Telegram: удаляет рекламу, мат, скам и вирусные .apk. " +
  "Модерация телеграм-группы на русском и узбекском, настройки — в панели прямо внутри Telegram.";

export const metadata: Metadata = {
  // Without metadataBase every OG/canonical URL resolves relatively and breaks
  // the moment the link is shared back into Telegram (GROWTH.md §0, item 7).
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE_DEFAULT,
    template: `%s — ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  // Google ignores this tag; kept because Yandex — the primary RU/UZ engine
  // for this product — still reads it.
  keywords: [
    "бот модератор телеграм",
    "антиспам бот telegram",
    "бот против мата",
    "удаление apk в телеграме",
    "модерация телеграм группы",
    "антиспам бот для телеграм группы",
    "фильтр мата телеграм",
    "бот модератор чата узбекский",
    "антискам бот телеграм",
    "бот против скама",
    "защита от мошенников телеграм",
  ],
  // INHERITED by every route that does not declare its own. Any new public
  // page (/uz, /terms, /blog/*) MUST set its own `alternates.canonical`, or it
  // will tell Google it is a duplicate of the homepage. No lint or typecheck
  // catches this.
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    title: TITLE_DEFAULT,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "ru_RU",
    // Images come from the app/opengraph-image.tsx file convention, which
    // Next resolves against metadataBase automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE_DEFAULT,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full" data-theme="light" suppressHydrationWarning>
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

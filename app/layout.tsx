import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Модератор — панель управления",
  description: "Панель управления ботом-модератором Telegram-групп",
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

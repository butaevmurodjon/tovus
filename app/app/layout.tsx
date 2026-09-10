import { Providers } from "../providers";

/**
 * The Mini App shell. `<Providers>` (AppProvider — Telegram initData, the
 * fetcher, i18n) lives HERE rather than in the root layout so the public
 * marketing pages (`/`, `/privacy`) don't mount a client context tree they
 * never read. Everything under `/app` is a Client Component that needs it.
 *
 * `telegram-web-app.js` stays in the ROOT layout on purpose: it must load
 * `beforeInteractive` (Next only honours that in the root layout), and
 * `useTelegramWebApp` checks for `window.Telegram.WebApp` exactly once with no
 * retry — the script has to be there before the first effect runs.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}

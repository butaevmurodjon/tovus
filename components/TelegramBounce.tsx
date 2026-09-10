"use client";

import { useEffect } from "react";

/**
 * POST-HYDRATION BACKSTOP for the Mini App bounce. The primary redirect is the
 * synchronous inline script at the top of `app/page.tsx` — read the long
 * ordering comment there first; this file only covers what that script cannot.
 *
 * Why the bounce exists at all: Mini App links minted before the move from `/`
 * to `/app` (GROWTH.md §3.2) — inline `web_app` buttons already sitting in
 * group chats, menu buttons cached on Telegram clients — still point at the
 * bare domain, and those cannot be recalled. `next.config.ts` cannot help: a
 * redirect on `/` would make the landing unreachable for crawlers, which is
 * the whole point of the move.
 *
 * This and the inline script are the ONLY places in the app where "is this
 * Telegram?" is detected, and both have to be client-side: `tgWebAppData`
 * arrives in the URL *fragment*, which browsers never send to the server, and
 * the Telegram WebView otherwise sends an ordinary User-Agent. Server-side
 * sniffing would either break the Mini App or break indexing.
 *
 * What this covers that the inline script does not: the inline script runs
 * once, while the HTML is still parsing. If at that instant BOTH signals were
 * absent — `telegram-web-app.js` had not finished populating `window.Telegram`
 * AND the client had not put `tgWebAppData` in the fragment (some clients hand
 * initData over only through the injected bridge) — the script correctly did
 * nothing, and this effect is the second look, after hydration, when
 * `window.Telegram.WebApp` definitely exists.
 *
 * Three details that are load-bearing:
 *
 * - `window.location.hash` is carried across verbatim. That fragment IS the
 *   session — drop it and the Mini App lands on `/app` with no initData and
 *   renders "открой через кнопку в боте".
 * - `location.replace`, not `assign`/`router.push`: the landing must not sit
 *   in history, or Telegram's back button bounces the user right back into
 *   this redirect.
 * - The `initData` guard is `typeof initData === "string" && initData.length > 0`.
 *   `window.Telegram.WebApp` also exists in a plain browser tab whenever the
 *   telegram-web-app.js script in the root layout has loaded, with `initData`
 *   as an empty string — testing for the object alone would redirect every
 *   ordinary visitor, crawlers included, off the landing page.
 *
 * The hash test is `/[#&?]tgWebAppData=/`, NOT "hash is non-empty": the
 * landing has anchor targets (`#features`, `#how`, `#faq`), and a
 * non-empty-hash test would throw every visitor who clicked an in-page link
 * into `/app`. Keep this predicate identical to the inline script's.
 */
/**
 * Bounded retry, not a single look. Hydration normally happens well after the
 * blocking `telegram-web-app.js` in <head> has run, so one check would do —
 * but "normally" is doing a lot of work in that sentence, and a headless probe
 * of this file confirmed that a bridge which populates `initData` even 250ms
 * after hydration slips past a one-shot effect entirely. Polling for two
 * seconds closes that window.
 *
 * Why this cannot fire on an ordinary visitor even at t = 2s: the predicate
 * needs a NON-EMPTY `initData` (or a `tgWebAppData=` fragment). In a plain
 * browser tab `initData` is `""` forever — nothing turns it into a session
 * string later. So there is no timeline on which a real reader gets yanked
 * off the page mid-sentence.
 */
const RETRY_INTERVAL_MS = 100;
const RETRY_WINDOW_MS = 2000;

export function TelegramBounce() {
  useEffect(() => {
    if (window.location.pathname !== "/") return;

    // `location.replace()` does not stop this frame's timers synchronously, so
    // without the latch the interval would keep re-issuing the same navigation
    // every 100ms while the first one is still in flight.
    let done = false;

    const attempt = () => {
      if (done) return true;

      const hash = window.location.hash || "";
      const initData = window.Telegram?.WebApp?.initData;

      const isTelegram =
        /[#&?]tgWebAppData=/.test(hash) || (typeof initData === "string" && initData.length > 0);

      if (!isTelegram) return false;

      // Hide before navigating, not after: `location.replace()` is not
      // instantaneous and the browser is free to paint while the navigation is
      // in flight. Only ever reached in the detected branch, so a crawler or an
      // ordinary visitor never sees a hidden page.
      done = true;
      document.documentElement.style.visibility = "hidden";
      window.location.replace(`/app${hash}`);
      return true;
    };

    if (attempt()) return;

    const timer = window.setInterval(attempt, RETRY_INTERVAL_MS);
    const stop = window.setTimeout(() => window.clearInterval(timer), RETRY_WINDOW_MS);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  return null;
}

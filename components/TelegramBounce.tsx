"use client";

import { useEffect } from "react";

/**
 * Safety net for Mini App links minted before the move from `/` to `/app`
 * (GROWTH.md §3.2): inline `web_app` buttons already sitting in group chats
 * and menu buttons cached on Telegram clients still point at the bare domain,
 * and those cannot be recalled. `next.config.ts` cannot help — a redirect on
 * `/` would make the landing page unreachable for crawlers, which is the whole
 * point of the move.
 *
 * This is the ONLY place in the app where "is this Telegram?" is detected.
 * It has to be here and it has to be client-side: `tgWebAppData` arrives in
 * the URL *fragment*, which browsers never send to the server, and the
 * Telegram WebView otherwise sends an ordinary User-Agent. Server-side
 * sniffing would either break the Mini App or break indexing.
 *
 * Three details that are load-bearing:
 *
 * - `window.location.hash` is carried across verbatim. That fragment IS the
 *   session — drop it and the Mini App lands on `/app` with no initData and
 *   renders "открой через кнопку в боте".
 * - `location.replace`, not `assign`/`router.push`: the landing must not sit
 *   in history, or Telegram's back button bounces the user right back into
 *   this redirect.
 * - The guard is `typeof initData === "string" && initData.length > 0`.
 *   `window.Telegram.WebApp` also exists in a plain browser tab whenever the
 *   telegram-web-app.js script in the root layout has loaded, with `initData`
 *   as an empty string — testing for the object alone would redirect every
 *   ordinary visitor, crawlers included, off the landing page.
 */
export function TelegramBounce() {
  useEffect(() => {
    const initData = window.Telegram?.WebApp?.initData;
    if (typeof initData === "string" && initData.length > 0) {
      window.location.replace(`/app${window.location.hash}`);
    }
  }, []);

  return null;
}

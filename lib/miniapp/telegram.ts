"use client";

import { useEffect, useRef, useState } from "react";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramBackButton {
  isVisible: boolean;
  show: () => TelegramBackButton;
  hide: () => TelegramBackButton;
  onClick: (cb: () => void) => TelegramBackButton;
  offClick: (cb: () => void) => TelegramBackButton;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser; start_param?: string };
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
  openTelegramLink?: (url: string) => void;
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
  /** Bot API 6.1+. Absent (not just unsupported) on very old clients — every
   * call site must optional-chain. */
  BackButton?: TelegramBackButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function useTelegramWebApp() {
  const [initData, setInitData] = useState<string | null>(null);
  const [inTelegram, setInTelegram] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [startParam, setStartParam] = useState<string | null>(null);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBootstrapped(true);
      return;
    }
    wa.ready();
    wa.expand();
    wa.disableVerticalSwipes?.();
    try {
      wa.setHeaderColor("#ffffff");
      wa.setBackgroundColor("#f9f9f7");
    } catch {
      // older client versions may not support these calls
    }
    setInitData(wa.initData || null);
    // `?startapp=g-1001234567890` from /panel's deep link (miniAppButtonUrl
    // in commands.ts) — was read nowhere, so that link always landed on the
    // plain group list instead of the group it was for (FAANG-audit finding).
    setStartParam(wa.initDataUnsafe?.start_param || null);
    setInTelegram(true);
    setBootstrapped(true);
  }, []);

  return { initData, inTelegram, bootstrapped, startParam };
}

/**
 * Wires Telegram's native BackButton (top-left chevron in the client's own
 * chrome, not our in-page TopBar arrow) to `onBack`. Pass `null` to hide it
 * on screens with nowhere to go back to (the dashboard root).
 *
 * Why this exists at all: without it, Android's system back gesture closes
 * the whole Mini App instead of going up one level — harmless while the app
 * was a single flat screen per section, but a real trap once any screen has
 * a level below it (subscreens, resolved-entity views, etc).
 *
 * `offClick` in the cleanup is not optional — Telegram's BackButton keeps
 * every registered handler until explicitly removed, so skipping it would
 * stack a handler per navigation and fire all of them (all prior `onBack`s
 * plus the current one) on the next single tap.
 */
export function useTelegramBackButton(onBack: (() => void) | null) {
  const onBackRef = useRef(onBack);
  // Ref writes must happen outside render (React's own rule) — this effect
  // has no deps array so it runs after every commit, keeping the ref fresh
  // without re-registering the BackButton handler itself (that one only
  // re-runs on Boolean(onBack) flipping, see below).
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;
    if (!onBackRef.current) {
      try {
        bb.hide();
      } catch {
        // absent-but-throws client, same class of bug as showConfirm below
      }
      return;
    }
    const handler = () => onBackRef.current?.();
    try {
      bb.onClick(handler);
      bb.show();
    } catch {
      // method present but throws on some client versions — nothing to clean
      // up in that case, the button never actually registered
      return;
    }
    return () => {
      try {
        bb.offClick(handler);
        bb.hide();
      } catch {
        // best-effort cleanup only
      }
    };
    // Re-run only when going from "no target" to "has a target" or vice versa
    // — the ref keeps the closure fresh for a changed *same-shape* handler
    // without tearing down and re-registering on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(onBack)]);
}

export function haptic(style: "light" | "medium" | "heavy" = "light") {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotify(type: "error" | "success" | "warning") {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
}

/** Opens the Stars checkout sheet for an invoice link created via createInvoiceLink. */
export function openInvoice(url: string, onStatus?: (status: "paid" | "cancelled" | "failed" | "pending") => void) {
  const wa = window.Telegram?.WebApp;
  if (!wa?.openInvoice) {
    window.open(url, "_blank");
    return;
  }
  try {
    wa.openInvoice(url, onStatus);
  } catch {
    // Same class of client bug confirmAction below works around: the method
    // exists but throws instead of behaving predictably. Degrade the same way
    // the "absent" branch above does, rather than losing Stars checkout entirely.
    window.open(url, "_blank");
  }
}

/** Opens a t.me/… link inside the Telegram client when the method is
 * available, otherwise a normal new tab (same degrade path as openInvoice). */
export function openTelegramLink(url: string) {
  const wa = window.Telegram?.WebApp;
  if (wa?.openTelegramLink) {
    try {
      wa.openTelegramLink(url);
      return;
    } catch {
      // method present but throws on older clients — fall through
    }
  }
  window.open(url, "_blank");
}

/** Native confirm sheet for destructive actions (clear-all). Falls back to
 * window.confirm outside Telegram, and on client versions where `showConfirm`
 * exists as a function but throws WebAppMethodUnsupported synchronously instead
 * of just being absent (observed on the WebView's own "unsupported version"
 * shim) — that throw would otherwise reject this promise and silently swallow
 * the whole clear-all action before window.confirm ever ran. */
export function confirmAction(message: string): Promise<boolean> {
  const wa = window.Telegram?.WebApp;
  if (wa?.showConfirm) {
    // The try/catch must wrap the actual call *inside* the executor: a `new
    // Promise(executor)` that throws is caught by the engine and turned into a
    // rejection, not a synchronous throw the caller could catch here.
    const viaTelegram = new Promise<boolean>((resolve) => {
      try {
        wa.showConfirm!(message, resolve);
      } catch {
        resolve(window.confirm(message));
      }
    }).catch(() => window.confirm(message));
    // Some client versions implement showConfirm as a silent no-op — present,
    // doesn't throw, but never invokes its callback either — which would hang
    // this promise forever with no way for the caller to recover. Treat "no
    // response within a few seconds" as declined: the safe default for a
    // destructive action is to make the admin re-click, not to guess yes.
    const noResponse = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 4000);
    });
    return Promise.race([viaTelegram, noResponse]);
  }
  return Promise.resolve(window.confirm(message));
}

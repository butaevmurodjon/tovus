"use client";

import { useEffect, useState } from "react";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
  };
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
    setInTelegram(true);
    setBootstrapped(true);
  }, []);

  return { initData, inTelegram, bootstrapped };
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

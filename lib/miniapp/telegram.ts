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

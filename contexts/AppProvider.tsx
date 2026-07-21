"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTelegramWebApp, type TelegramWebAppUser } from "@/lib/miniapp/telegram";
import { createFetcher, type Fetcher } from "@/lib/miniapp/api";
import { DEFAULT_LANG, t as translate, type Lang } from "@/lib/i18n";

type Status = "loading" | "ready" | "no-telegram" | "error";

interface AppContextValue {
  status: Status;
  user: TelegramWebAppUser | null;
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  fetcher: Fetcher;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { initData, inTelegram, bootstrapped } = useTelegramWebApp();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<TelegramWebAppUser | null>(null);
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  const fetcher = useMemo(() => createFetcher(initData), [initData]);

  useEffect(() => {
    if (!bootstrapped) return;
    if (!inTelegram || !initData) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("no-telegram");
      return;
    }
    let cancelled = false;
    fetcher<{ user: TelegramWebAppUser; lang: Lang }>("/api/miniapp/me")
      .then((data) => {
        if (cancelled) return;
        setUser(data.user);
        setLangState(data.lang);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, inTelegram, initData, fetcher]);

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next);
      fetcher("/api/miniapp/me", { method: "PATCH", body: JSON.stringify({ lang: next }) }).catch(() => {});
    },
    [fetcher]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang]
  );

  const value: AppContextValue = { status, user, lang, setLang, t, fetcher };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

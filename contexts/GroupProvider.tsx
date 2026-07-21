"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { ApiError } from "@/lib/miniapp/api";
import type { GroupSettings } from "@/lib/db/types";

type Status = "loading" | "ready" | "forbidden" | "error";

interface GroupContextValue {
  status: Status;
  chatId: number;
  settings: GroupSettings | null;
  whitelist: number[];
  missingPermissions: string[];
  refresh: () => void;
  updateSettings: (patch: Partial<GroupSettings>) => Promise<void>;
  setWhitelist: (ids: number[]) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

export function GroupProvider({ chatId, children }: { chatId: number; children: React.ReactNode }) {
  const { status: appStatus, fetcher } = useApp();
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [whitelist, setWhitelist] = useState<number[]>([]);
  const [missingPermissions, setMissingPermissions] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (appStatus !== "ready" || Number.isNaN(chatId)) return;
    let cancelled = false;
    setStatus("loading");
    fetcher<{ settings: GroupSettings; whitelist: number[]; missingPermissions: string[] }>(
      `/api/miniapp/groups/${chatId}`
    )
      .then((data) => {
        if (cancelled) return;
        setSettings(data.settings);
        setWhitelist(data.whitelist);
        setMissingPermissions(data.missingPermissions ?? []);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [appStatus, chatId, fetcher]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const cleanup = load();
    return cleanup;
  }, [load, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const updateSettings = useCallback(
    async (patch: Partial<GroupSettings>) => {
      const data = await fetcher<{ settings: GroupSettings; missingPermissions: string[] }>(
        `/api/miniapp/groups/${chatId}`,
        { method: "PATCH", body: JSON.stringify(patch) }
      );
      setSettings(data.settings);
      setMissingPermissions(data.missingPermissions ?? []);
    },
    [chatId, fetcher]
  );

  const value: GroupContextValue = {
    status,
    chatId,
    settings,
    whitelist,
    missingPermissions,
    refresh,
    updateSettings,
    setWhitelist,
  };

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup(): GroupContextValue {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroup must be used within GroupProvider");
  return ctx;
}

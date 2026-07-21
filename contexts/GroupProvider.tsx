"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { ApiError } from "@/lib/miniapp/api";
import type { GroupSettings } from "@/lib/db/types";

type Status = "loading" | "ready" | "forbidden" | "error";

interface GroupStatusFields {
  missingPermissions: string[];
  memberCount: number | null;
  proFeaturesEligible: boolean;
}

interface GroupContextValue extends GroupStatusFields {
  status: Status;
  chatId: number;
  settings: GroupSettings | null;
  whitelist: number[];
  refresh: () => void;
  updateSettings: (patch: Partial<GroupSettings>) => Promise<void>;
  setWhitelist: (ids: number[]) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

const EMPTY_STATUS: GroupStatusFields = { missingPermissions: [], memberCount: null, proFeaturesEligible: true };

export function GroupProvider({ chatId, children }: { chatId: number; children: React.ReactNode }) {
  const { status: appStatus, fetcher } = useApp();
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [whitelist, setWhitelist] = useState<number[]>([]);
  const [statusFields, setStatusFields] = useState<GroupStatusFields>(EMPTY_STATUS);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (appStatus !== "ready" || Number.isNaN(chatId)) return;
    let cancelled = false;
    setStatus("loading");
    fetcher<{ settings: GroupSettings; whitelist: number[] } & GroupStatusFields>(`/api/miniapp/groups/${chatId}`)
      .then((data) => {
        if (cancelled) return;
        setSettings(data.settings);
        setWhitelist(data.whitelist);
        setStatusFields({
          missingPermissions: data.missingPermissions ?? [],
          memberCount: data.memberCount ?? null,
          proFeaturesEligible: data.proFeaturesEligible ?? true,
        });
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
      const data = await fetcher<{ settings: GroupSettings } & GroupStatusFields>(`/api/miniapp/groups/${chatId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSettings(data.settings);
      setStatusFields({
        missingPermissions: data.missingPermissions ?? [],
        memberCount: data.memberCount ?? null,
        proFeaturesEligible: data.proFeaturesEligible ?? true,
      });
    },
    [chatId, fetcher]
  );

  const value: GroupContextValue = {
    status,
    chatId,
    settings,
    whitelist,
    ...statusFields,
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

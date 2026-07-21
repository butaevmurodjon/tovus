"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { ApiError } from "@/lib/miniapp/api";
import { optimisticUpdate } from "@/lib/miniapp/optimistic";
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
  refresh: () => void;
  /**
   * Applies immediately in the UI. Resolves with the list of field names the
   * server rejected (e.g. a gated toggle turned on while ineligible) — empty
   * if everything was accepted. Only throws if the server rejected the whole
   * request (network failure, or every field in the patch was rejected).
   */
  updateSettings: (patch: Partial<GroupSettings>) => Promise<string[]>;
}

const GroupContext = createContext<GroupContextValue | null>(null);

const EMPTY_STATUS: GroupStatusFields = { missingPermissions: [], memberCount: null, proFeaturesEligible: true };

export function GroupProvider({ chatId, children }: { chatId: number; children: React.ReactNode }) {
  const { status: appStatus, fetcher } = useApp();
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [statusFields, setStatusFields] = useState<GroupStatusFields>(EMPTY_STATUS);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (appStatus !== "ready" || Number.isNaN(chatId)) return;
    let cancelled = false;
    setStatus("loading");
    fetcher<{ settings: GroupSettings } & GroupStatusFields>(`/api/miniapp/groups/${chatId}`)
      .then((data) => {
        if (cancelled) return;
        setSettings(data.settings);
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

  const fetchSettings = useCallback(
    async () => (await fetcher<{ settings: GroupSettings }>(`/api/miniapp/groups/${chatId}`)).settings,
    [chatId, fetcher]
  );

  // On failure, reconciles with a fresh fetch rather than restoring the
  // snapshot captured before this call started — restoring a stale snapshot
  // would clobber a different, already-committed change made by a concurrent
  // call in the meantime (e.g. two toggles fired in quick succession).
  const updateSettings = useCallback(
    async (patch: Partial<GroupSettings>): Promise<string[]> => {
      let rejected: string[] = [];
      await optimisticUpdate<GroupSettings | null>(
        setSettings,
        (cur) => (cur ? { ...cur, ...patch } : cur),
        async () => {
          const data = await fetcher<{ settings: GroupSettings; rejected?: string[] } & GroupStatusFields>(
            `/api/miniapp/groups/${chatId}`,
            { method: "PATCH", body: JSON.stringify(patch) }
          );
          rejected = data.rejected ?? [];
          setStatusFields({
            missingPermissions: data.missingPermissions ?? [],
            memberCount: data.memberCount ?? null,
            proFeaturesEligible: data.proFeaturesEligible ?? true,
          });
          return data.settings;
        },
        fetchSettings
      );
      return rejected;
    },
    [chatId, fetcher, fetchSettings]
  );

  const value: GroupContextValue = {
    status,
    chatId,
    settings,
    ...statusFields,
    refresh,
    updateSettings,
  };

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup(): GroupContextValue {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroup must be used within GroupProvider");
  return ctx;
}

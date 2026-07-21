"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { ApiError } from "@/lib/miniapp/api";
import { hapticNotify } from "@/lib/miniapp/telegram";
import { PRESETS, type PresetKey } from "@/lib/moderation/presets";
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
  customWords: string[] | null;
  refresh: () => void;
  /** Applies immediately in the UI; only reverts if the server actually rejects the whole request. */
  updateSettings: (patch: Partial<GroupSettings>) => Promise<void>;
  addWhitelistUser: (userId: number) => Promise<void>;
  removeWhitelistUser: (userId: number) => Promise<void>;
  clearWhitelistAll: () => Promise<void>;
  addCustomWordEntry: (word: string) => Promise<void>;
  removeCustomWordEntry: (word: string) => Promise<void>;
  clearCustomWordsAll: () => Promise<void>;
  applyPreset: (preset: PresetKey) => Promise<number>;
}

const GroupContext = createContext<GroupContextValue | null>(null);

const EMPTY_STATUS: GroupStatusFields = { missingPermissions: [], memberCount: null, proFeaturesEligible: true };

export function GroupProvider({ chatId, children }: { chatId: number; children: React.ReactNode }) {
  const { status: appStatus, fetcher } = useApp();
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [whitelist, setWhitelist] = useState<number[]>([]);
  const [customWords, setCustomWords] = useState<string[] | null>(null);
  const [statusFields, setStatusFields] = useState<GroupStatusFields>(EMPTY_STATUS);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (appStatus !== "ready" || Number.isNaN(chatId)) return;
    let cancelled = false;
    setStatus("loading");
    Promise.all([
      fetcher<{ settings: GroupSettings; whitelist: number[] } & GroupStatusFields>(`/api/miniapp/groups/${chatId}`),
      fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`),
    ])
      .then(([groupData, wordsData]) => {
        if (cancelled) return;
        setSettings(groupData.settings);
        setWhitelist(groupData.whitelist);
        setCustomWords(wordsData.words);
        setStatusFields({
          missingPermissions: groupData.missingPermissions ?? [],
          memberCount: groupData.memberCount ?? null,
          proFeaturesEligible: groupData.proFeaturesEligible ?? true,
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

  // Applies the patch to local state immediately, sends it in the background, and
  // only rolls back if the server rejected the whole request (thrown error) — a
  // partial-accept 200 (some fields rejected, e.g. a gated toggle) keeps the
  // server's authoritative merged settings, since those accepted fields are real.
  const updateSettings = useCallback(
    async (patch: Partial<GroupSettings>) => {
      let prev: GroupSettings | null = null;
      setSettings((cur) => {
        prev = cur;
        return cur ? { ...cur, ...patch } : cur;
      });
      try {
        const data = await fetcher<{ settings: GroupSettings } & GroupStatusFields>(
          `/api/miniapp/groups/${chatId}`,
          { method: "PATCH", body: JSON.stringify(patch) }
        );
        setSettings(data.settings);
        setStatusFields({
          missingPermissions: data.missingPermissions ?? [],
          memberCount: data.memberCount ?? null,
          proFeaturesEligible: data.proFeaturesEligible ?? true,
        });
      } catch (err) {
        setSettings(prev);
        throw err;
      }
    },
    [chatId, fetcher]
  );

  const addWhitelistUser = useCallback(
    async (userId: number) => {
      let prev: number[] = [];
      setWhitelist((cur) => {
        prev = cur;
        return cur.includes(userId) ? cur : [...cur, userId];
      });
      try {
        const data = await fetcher<{ whitelist: number[] }>(`/api/miniapp/groups/${chatId}/whitelist`, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        setWhitelist(data.whitelist);
      } catch {
        setWhitelist(prev);
        hapticNotify("error");
      }
    },
    [chatId, fetcher]
  );

  const removeWhitelistUser = useCallback(
    async (userId: number) => {
      let prev: number[] = [];
      setWhitelist((cur) => {
        prev = cur;
        return cur.filter((id) => id !== userId);
      });
      try {
        const data = await fetcher<{ whitelist: number[] }>(
          `/api/miniapp/groups/${chatId}/whitelist?userId=${userId}`,
          { method: "DELETE" }
        );
        setWhitelist(data.whitelist);
      } catch {
        setWhitelist(prev);
        hapticNotify("error");
      }
    },
    [chatId, fetcher]
  );

  const clearWhitelistAll = useCallback(async () => {
    let prev: number[] = [];
    setWhitelist((cur) => {
      prev = cur;
      return [];
    });
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/whitelist?all=1`, { method: "DELETE" });
    } catch {
      setWhitelist(prev);
      hapticNotify("error");
    }
  }, [chatId, fetcher]);

  const addCustomWordEntry = useCallback(
    async (word: string) => {
      const trimmed = word.trim().toLowerCase();
      if (!trimmed) return;
      let prev: string[] | null = null;
      setCustomWords((cur) => {
        prev = cur;
        return cur ? Array.from(new Set([...cur, trimmed])).sort() : cur;
      });
      try {
        const data = await fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`, {
          method: "POST",
          body: JSON.stringify({ word: trimmed }),
        });
        setCustomWords(data.words);
      } catch {
        setCustomWords(prev);
        hapticNotify("error");
      }
    },
    [chatId, fetcher]
  );

  const removeCustomWordEntry = useCallback(
    async (word: string) => {
      let prev: string[] | null = null;
      setCustomWords((cur) => {
        prev = cur;
        return cur ? cur.filter((w) => w !== word) : cur;
      });
      try {
        const data = await fetcher<{ words: string[] }>(
          `/api/miniapp/groups/${chatId}/customwords?word=${encodeURIComponent(word)}`,
          { method: "DELETE" }
        );
        setCustomWords(data.words);
      } catch {
        setCustomWords(prev);
        hapticNotify("error");
      }
    },
    [chatId, fetcher]
  );

  const clearCustomWordsAll = useCallback(async () => {
    let prev: string[] | null = null;
    setCustomWords((cur) => {
      prev = cur;
      return [];
    });
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/customwords?all=1`, { method: "DELETE" });
    } catch {
      setCustomWords(prev);
      hapticNotify("error");
    }
  }, [chatId, fetcher]);

  const applyPreset = useCallback(
    async (preset: PresetKey): Promise<number> => {
      let prev: string[] | null = null;
      setCustomWords((cur) => {
        prev = cur;
        return Array.from(new Set([...(cur ?? []), ...PRESETS[preset]])).sort();
      });
      try {
        const data = await fetcher<{ added: number; words: string[] }>(`/api/miniapp/groups/${chatId}/presets`, {
          method: "POST",
          body: JSON.stringify({ preset }),
        });
        setCustomWords(data.words);
        return data.added;
      } catch {
        setCustomWords(prev);
        hapticNotify("error");
        return 0;
      }
    },
    [chatId, fetcher]
  );

  const value: GroupContextValue = {
    status,
    chatId,
    settings,
    whitelist,
    customWords,
    ...statusFields,
    refresh,
    updateSettings,
    addWhitelistUser,
    removeWhitelistUser,
    clearWhitelistAll,
    addCustomWordEntry,
    removeCustomWordEntry,
    clearCustomWordsAll,
    applyPreset,
  };

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup(): GroupContextValue {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroup must be used within GroupProvider");
  return ctx;
}

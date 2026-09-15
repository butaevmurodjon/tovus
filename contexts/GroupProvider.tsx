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
  federationEligible: boolean;
  /** For the §6.5 priority-5 overview card. Both come only from GET (PATCH
   * doesn't recompute them — no settings patch changes either), so they fall
   * back to the previous value below whenever a response omits them. Same
   * staleness tradeoff as memberCount/missingPermissions above: this
   * provider lives in layout.tsx and outlives the settings page, so
   * whitelisting someone (or a new violation landing) on another tab under
   * the same group does NOT refresh these until the next full `load()` —
   * i.e. next mount of GroupProvider itself, or an explicit `refresh()`.
   * A snapshot-on-open glance, not a live counter. */
  whitelistCount: number;
  /** Same snapshot-on-open caveat as whitelistCount — for the settings
   * index's "Списки и слова" status subtitle (PR-1). */
  customWordsCount: number;
  allowlistCount: number;
  violationsToday: number;
  /** `t.me/<bot>?start=support_<chatId>` — "Написать разработчику" deep link,
   * or null when TELEGRAM_BOT_USERNAME isn't provisioned (page must then omit
   * the button, same convention as the other *Url fields elsewhere). */
  supportUrl: string | null;
  /** Whether OCR_API_KEY is provisioned — `ocrEnabled` is a real no-op
   * without it (see lib/moderation/ocr.ts), so the settings page disables
   * the toggle and explains why instead of showing a silently-dead "on". */
  ocrConfigured: boolean;
  /** Whether DIGEST_HUB_CHAT_ID is provisioned — the daily-AI-summary cron
   * skips every group without it (see api/cron/daily-summary), so the
   * owner-only toggle for this group is disabled + explained rather than
   * looking live when it can never fire. */
  digestHubConfigured: boolean;
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

const EMPTY_STATUS: GroupStatusFields = {
  missingPermissions: [],
  memberCount: null,
  federationEligible: true,
  whitelistCount: 0,
  customWordsCount: 0,
  allowlistCount: 0,
  violationsToday: 0,
  supportUrl: null,
  ocrConfigured: true,
  digestHubConfigured: true,
};

export function GroupProvider({ chatId, children }: { chatId: number; children: React.ReactNode }) {
  const { status: appStatus, fetcher } = useApp();
  const [status, setStatus] = useState<Status>("loading");
  const [settings, setSettings] = useState<GroupSettings | null>(null);
  const [statusFields, setStatusFields] = useState<GroupStatusFields>(EMPTY_STATUS);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    if (appStatus !== "ready") return;
    if (!Number.isFinite(chatId)) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetcher<{ settings: GroupSettings } & GroupStatusFields>(`/api/miniapp/groups/${chatId}`)
      .then((data) => {
        if (cancelled) return;
        setSettings(data.settings);
        setStatusFields({
          missingPermissions: data.missingPermissions ?? [],
          memberCount: data.memberCount ?? null,
          federationEligible: data.federationEligible ?? true,
          whitelistCount: data.whitelistCount ?? 0,
          customWordsCount: data.customWordsCount ?? 0,
          allowlistCount: data.allowlistCount ?? 0,
          violationsToday: data.violationsToday ?? 0,
          supportUrl: data.supportUrl ?? null,
          ocrConfigured: data.ocrConfigured ?? true,
          digestHubConfigured: data.digestHubConfigured ?? true,
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
          const data = await fetcher<
            { settings: GroupSettings; rejected?: string[] } & Partial<GroupStatusFields>
          >(`/api/miniapp/groups/${chatId}`, { method: "PATCH", body: JSON.stringify(patch) });
          rejected = data.rejected ?? [];
          // PATCH returns memberCount + federationEligible but not
          // missingPermissions (that needs uncached getBotPermissions calls not
          // worth paying per toggle) — keep the prior value for any field the
          // response omits instead of wiping it until the next full refresh.
          setStatusFields((prev) => ({
            missingPermissions: data.missingPermissions ?? prev.missingPermissions,
            memberCount: data.memberCount ?? prev.memberCount,
            federationEligible: data.federationEligible ?? prev.federationEligible,
            whitelistCount: data.whitelistCount ?? prev.whitelistCount,
            customWordsCount: data.customWordsCount ?? prev.customWordsCount,
            allowlistCount: data.allowlistCount ?? prev.allowlistCount,
            violationsToday: data.violationsToday ?? prev.violationsToday,
            supportUrl: prev.supportUrl,
            ocrConfigured: prev.ocrConfigured,
            digestHubConfigured: prev.digestHubConfigured,
          }));
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

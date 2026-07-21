"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { JournalItem } from "@/components/JournalItem";
import { StatusScreen } from "@/components/StatusScreen";
import { haptic, hapticNotify, confirmAction } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";
import { optimisticUpdate } from "@/lib/miniapp/optimistic";
import { PRESETS, PRESET_KEYS, type PresetKey } from "@/lib/moderation/presets";
import type { JournalEntry } from "@/lib/db/types";

const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  agro: "miniapp.presetAgro",
  ecommerce: "miniapp.presetEcommerce",
  edtech: "miniapp.presetEdtech",
  finance: "miniapp.presetFinance",
};

type Tab = "journal" | "whitelist" | "words";
type T = (key: string, params?: Record<string, string | number>) => string;

export default function GroupJournalPage() {
  const { t, fetcher } = useApp();
  const [tab, setTab] = useState<Tab>("journal");
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 1600);
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      {toast && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          style={{ background: "var(--ink)", color: "#fff" }}
        >
          {toast}
        </div>
      )}
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        columns={3}
        options={[
          { value: "journal", label: t("miniapp.tabJournal") },
          { value: "whitelist", label: t("miniapp.tabWhitelist") },
          { value: "words", label: t("miniapp.tabWordFilter") },
        ]}
      />
      {tab === "journal" && <JournalTab t={t} fetcher={fetcher} />}
      {tab === "whitelist" && <WhitelistTab t={t} flash={flash} />}
      {tab === "words" && <WordFilterTab t={t} flash={flash} />}
    </div>
  );
}

function JournalTab({
  t,
  fetcher,
}: {
  t: T;
  fetcher: <R>(path: string, options?: RequestInit) => Promise<R>;
}) {
  const { chatId } = useGroup();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetcher<{ entries: JournalEntry[] }>(`/api/miniapp/groups/${chatId}/journal`)
      .then((d) => !cancelled && setEntries(d.entries))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [chatId, fetcher]);

  async function restore(id: string) {
    setRestoringId(id);
    try {
      const data = await fetcher<{ entry: JournalEntry }>(
        `/api/miniapp/groups/${chatId}/journal/${id}/restore`,
        { method: "POST" }
      );
      setEntries((cur) => cur?.map((e) => (e.id === id ? data.entry : e)) ?? cur);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
    } finally {
      setRestoringId(null);
    }
  }

  if (error) return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!entries) return <StatusScreen title={t("common.loading")} />;

  const labels = {
    category: {
      profanity: t("miniapp.categoryProfanity"),
      spam: t("miniapp.categorySpam"),
      premium: t("miniapp.categoryPremium"),
    },
    action: {
      delete: t("miniapp.actionDelete"),
      warn: t("miniapp.actionWarn"),
      mute: t("miniapp.actionMute"),
      ban: t("miniapp.actionBan"),
    },
    restore: t("miniapp.restore"),
    restored: t("miniapp.restored"),
    reasonLabel: t("miniapp.reasonLabel"),
  };

  return (
    <div className="flex flex-col gap-2.5">
      {entries.length === 0 && (
        <p className="text-[13px] text-center py-12" style={{ color: "var(--ink-muted)" }}>
          {t("miniapp.journalEmpty")}
        </p>
      )}
      {entries.map((entry) => (
        <JournalItem
          key={entry.id}
          entry={entry}
          labels={labels}
          onRestore={restore}
          restoring={restoringId === entry.id}
        />
      ))}
    </div>
  );
}

/**
 * Whitelist and custom-words are only ever read on this page (neither
 * settings, stats, nor the layout shell need them), so they're fetched here
 * as local per-tab state rather than bundled into GroupProvider's shared
 * load() — a hiccup fetching one no longer takes down settings/stats too,
 * and visiting a tab that doesn't need them no longer fetches them at all.
 */
function WhitelistTab({ t, flash }: { t: T; flash: (message: string) => void }) {
  const { chatId } = useGroup();
  const { fetcher } = useApp();
  const [whitelist, setWhitelist] = useState<number[] | null>(null);
  const [input, setInput] = useState("");

  const fetchWhitelist = useCallback(
    async () => (await fetcher<{ whitelist: number[] }>(`/api/miniapp/groups/${chatId}/whitelist`)).whitelist,
    [chatId, fetcher]
  );

  useEffect(() => {
    let cancelled = false;
    fetchWhitelist()
      .then((list) => !cancelled && setWhitelist(list))
      .catch(() => !cancelled && setWhitelist([]));
    return () => {
      cancelled = true;
    };
  }, [fetchWhitelist]);

  async function add() {
    const id = Number(input.trim());
    if (!Number.isFinite(id)) return;
    haptic("light");
    setInput("");
    try {
      await optimisticUpdate<number[] | null>(
        setWhitelist,
        (cur) => (cur && !cur.includes(id) ? [...cur, id] : cur),
        async () =>
          (
            await fetcher<{ whitelist: number[] }>(`/api/miniapp/groups/${chatId}/whitelist`, {
              method: "POST",
              body: JSON.stringify({ userId: id }),
            })
          ).whitelist,
        fetchWhitelist
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function remove(id: number) {
    try {
      await optimisticUpdate<number[] | null>(
        setWhitelist,
        (cur) => (cur ? cur.filter((x) => x !== id) : cur),
        async () =>
          (
            await fetcher<{ whitelist: number[] }>(`/api/miniapp/groups/${chatId}/whitelist?userId=${id}`, {
              method: "DELETE",
            })
          ).whitelist,
        fetchWhitelist
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function clearAll() {
    const confirmed = await confirmAction(t("miniapp.confirmDeleteAllWhitelist"));
    if (!confirmed) return;
    haptic("medium");
    try {
      await optimisticUpdate<number[] | null>(
        setWhitelist,
        () => [],
        async () => {
          await fetcher(`/api/miniapp/groups/${chatId}/whitelist?all=1`, { method: "DELETE" });
          return [];
        },
        fetchWhitelist
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  return (
    <Card>
      <CardSection title={t("miniapp.whitelistTitle")} subtitle={t("miniapp.whitelistHint")}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {whitelist?.length ?? 0}
          </span>
          {whitelist !== null && whitelist.length > 0 && (
            <Button variant="danger" onClick={clearAll}>
              {t("miniapp.deleteAll")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {whitelist !== null && whitelist.length === 0 && (
            <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              —
            </span>
          )}
          {(whitelist ?? []).map((id) => (
            <Badge key={id} variant="neutral">
              <span className="flex items-center gap-1.5">
                id{id}
                <button onClick={() => remove(id)} aria-label={t("common.remove")} className="font-bold">
                  ×
                </button>
              </span>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder={t("miniapp.whitelistAddPlaceholder")}
            inputMode="numeric"
            className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
            style={{ borderColor: "var(--border-strong)" }}
          />
          <Button variant="secondary" onClick={add}>
            {t("common.add")}
          </Button>
        </div>
      </CardSection>
    </Card>
  );
}

function WordFilterTab({ t, flash }: { t: T; flash: (message: string) => void }) {
  const { chatId } = useGroup();
  const { fetcher } = useApp();
  const [customWords, setCustomWords] = useState<string[] | null>(null);
  const [input, setInput] = useState("");
  const [applying, setApplying] = useState<PresetKey | null>(null);

  const fetchWords = useCallback(
    async () => (await fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`)).words,
    [chatId, fetcher]
  );

  useEffect(() => {
    let cancelled = false;
    fetchWords()
      .then((words) => !cancelled && setCustomWords(words))
      .catch(() => !cancelled && setCustomWords([]));
    return () => {
      cancelled = true;
    };
  }, [fetchWords]);

  async function add() {
    const word = input.trim();
    if (!word) return;
    haptic("light");
    setInput("");
    try {
      await optimisticUpdate<string[] | null>(
        setCustomWords,
        (cur) => (cur ? Array.from(new Set([...cur, word.toLowerCase()])).sort() : cur),
        async () =>
          (
            await fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`, {
              method: "POST",
              body: JSON.stringify({ word }),
            })
          ).words,
        fetchWords
      );
    } catch (err) {
      hapticNotify("error");
      flash(err instanceof ApiError && err.status === 409 ? t("miniapp.customWordCapReached") : t("miniapp.errorToast"));
    }
  }

  async function remove(word: string) {
    try {
      await optimisticUpdate<string[] | null>(
        setCustomWords,
        (cur) => (cur ? cur.filter((w) => w !== word) : cur),
        async () =>
          (
            await fetcher<{ words: string[] }>(
              `/api/miniapp/groups/${chatId}/customwords?word=${encodeURIComponent(word)}`,
              { method: "DELETE" }
            )
          ).words,
        fetchWords
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function clearAll() {
    const confirmed = await confirmAction(t("miniapp.confirmDeleteAllWords"));
    if (!confirmed) return;
    haptic("medium");
    try {
      await optimisticUpdate<string[] | null>(
        setCustomWords,
        () => [],
        async () => {
          await fetcher(`/api/miniapp/groups/${chatId}/customwords?all=1`, { method: "DELETE" });
          return [];
        },
        fetchWords
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function apply(preset: PresetKey) {
    haptic("light");
    setApplying(preset);
    let added: number | null = null;
    try {
      await optimisticUpdate<string[] | null>(
        setCustomWords,
        (cur) => Array.from(new Set([...(cur ?? []), ...PRESETS[preset]])).sort(),
        async () => {
          const data = await fetcher<{ added: number; words: string[] }>(`/api/miniapp/groups/${chatId}/presets`, {
            method: "POST",
            body: JSON.stringify({ preset }),
          });
          added = data.added;
          return data.words;
        },
        fetchWords
      );
    } catch {
      setApplying(null);
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
      return;
    }
    setApplying(null);
    // `added` is a real, already-fetched count here (only null if the try block
    // threw, which returns early above) — 0 is a legitimate "nothing new" outcome,
    // distinct from a failure, which never reaches this line.
    hapticNotify(added! > 0 ? "success" : "warning");
  }

  return (
    <>
      <Card>
        <CardSection title={t("miniapp.presetsTitle")} subtitle={t("miniapp.presetsHint")}>
          <div className="flex flex-wrap gap-2">
            {PRESET_KEYS.map((key) => (
              <Button key={key} variant="secondary" onClick={() => apply(key)} disabled={applying === key}>
                {t(PRESET_LABEL_KEY[key])}
              </Button>
            ))}
          </div>
        </CardSection>
      </Card>

      <Card className="mt-3">
        <CardSection title={t("miniapp.customWordsTitle")} subtitle={t("miniapp.customWordsHint")}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              {customWords?.length ?? 0}
            </span>
            {customWords !== null && customWords.length > 0 && (
              <Button variant="danger" onClick={clearAll}>
                {t("miniapp.deleteAll")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {customWords !== null && customWords.length === 0 && (
              <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                —
              </span>
            )}
            {(customWords ?? []).map((word) => (
              <Badge key={word} variant="neutral">
                <span className="flex items-center gap-1.5">
                  {word}
                  <button onClick={() => remove(word)} aria-label={t("common.remove")} className="font-bold">
                    ×
                  </button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={t("miniapp.customWordsAddPlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="secondary" onClick={add}>
              {t("common.add")}
            </Button>
          </div>
        </CardSection>
      </Card>
    </>
  );
}

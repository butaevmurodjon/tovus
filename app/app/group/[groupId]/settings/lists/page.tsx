"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { haptic, hapticNotify, confirmAction } from "@/lib/miniapp/telegram";
import { useToast, Toast } from "@/lib/miniapp/useToast";
import { ApiError } from "@/lib/miniapp/api";
import { optimisticUpdate } from "@/lib/miniapp/optimistic";
import { PRESETS, PRESET_KEYS, type PresetKey } from "@/lib/moderation/presets";

const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  agro: "miniapp.presetAgro",
  ecommerce: "miniapp.presetEcommerce",
  edtech: "miniapp.presetEdtech",
  finance: "miniapp.presetFinance",
};

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * "Списки и слова" subscreen (FAANG-audit PR-2) — moved out of "Журнал",
 * which used to bundle a read-only log together with three pieces of pure
 * configuration under an unrelated label. The journal itself keeps only
 * Лог + Обращения now. Order: user whitelist (most-touched), custom words +
 * industry presets, then the content allowlist (rarest).
 */
export default function ListsSettingsPage() {
  const { t } = useApp();
  const { toast, flash } = useToast();

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />
      <WhitelistCard t={t} flash={flash} />
      <WordFilterCard t={t} flash={flash} />
      <AllowlistCard t={t} flash={flash} />
    </div>
  );
}

/**
 * Whitelist and custom-words are only ever read on this screen, so they're
 * fetched here as local state rather than bundled into GroupProvider's
 * shared load() — a hiccup fetching one doesn't take down the settings
 * index too, and visiting the index no longer fetches them at all.
 */
function WhitelistCard({ t, flash }: { t: T; flash: (message: string) => void }) {
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
              <span className="flex items-center gap-1.5 max-w-full">
                <span className="min-w-0 break-all">id{id}</span>
                <button
                  onClick={() => remove(id)}
                  aria-label={t("common.remove")}
                  className="font-bold shrink-0 -my-1.5 -mr-1.5 py-1.5 pl-1.5 pr-2 leading-none active:opacity-60"
                >
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

/**
 * Content allowlist — domains and phrases the spam/link/profanity heuristics
 * must never flag. Distinct from the user-ID whitelist above: this is about
 * message content. Suppresses individual matched signals, not the whole
 * verdict, so an allowed domain can't be used to smuggle other spam.
 */
function AllowlistCard({ t, flash }: { t: T; flash: (message: string) => void }) {
  const { chatId } = useGroup();
  const { fetcher } = useApp();
  const [entries, setEntries] = useState<string[] | null>(null);
  const [input, setInput] = useState("");

  const fetchEntries = useCallback(
    async () => (await fetcher<{ entries: string[] }>(`/api/miniapp/groups/${chatId}/allowlist`)).entries,
    [chatId, fetcher]
  );

  useEffect(() => {
    let cancelled = false;
    fetchEntries()
      .then((list) => !cancelled && setEntries(list))
      .catch(() => !cancelled && setEntries([]));
    return () => {
      cancelled = true;
    };
  }, [fetchEntries]);

  async function add() {
    const entry = input.trim();
    if (!entry) return;
    haptic("light");
    setInput("");
    try {
      await optimisticUpdate<string[] | null>(
        setEntries,
        (cur) => (cur ? Array.from(new Set([...cur, entry.toLowerCase()])).sort() : cur),
        async () =>
          (
            await fetcher<{ entries: string[] }>(`/api/miniapp/groups/${chatId}/allowlist`, {
              method: "POST",
              body: JSON.stringify({ entry }),
            })
          ).entries,
        fetchEntries
      );
    } catch (err) {
      hapticNotify("error");
      flash(err instanceof ApiError && err.status === 409 ? t("miniapp.allowlistCapReached") : t("miniapp.errorToast"));
    }
  }

  async function remove(entry: string) {
    try {
      await optimisticUpdate<string[] | null>(
        setEntries,
        (cur) => (cur ? cur.filter((e) => e !== entry) : cur),
        async () =>
          (
            await fetcher<{ entries: string[] }>(
              `/api/miniapp/groups/${chatId}/allowlist?entry=${encodeURIComponent(entry)}`,
              { method: "DELETE" }
            )
          ).entries,
        fetchEntries
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function clearAll() {
    const confirmed = await confirmAction(t("miniapp.confirmDeleteAllAllowlist"));
    if (!confirmed) return;
    haptic("medium");
    try {
      await optimisticUpdate<string[] | null>(
        setEntries,
        () => [],
        async () => {
          await fetcher(`/api/miniapp/groups/${chatId}/allowlist?all=1`, { method: "DELETE" });
          return [];
        },
        fetchEntries
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  return (
    <Card>
      <CardSection title={t("miniapp.allowlistTitle")} subtitle={t("miniapp.allowlistHint")}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {entries?.length ?? 0}
          </span>
          {entries !== null && entries.length > 0 && (
            <Button variant="danger" onClick={clearAll}>
              {t("miniapp.deleteAll")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {entries !== null && entries.length === 0 && (
            <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              —
            </span>
          )}
          {(entries ?? []).map((entry) => (
            <Badge key={entry} variant="neutral">
              <span className="flex items-center gap-1.5 max-w-full">
                <span className="min-w-0 break-all">{entry}</span>
                <button
                  onClick={() => remove(entry)}
                  aria-label={t("common.remove")}
                  className="font-bold shrink-0 -my-1.5 -mr-1.5 py-1.5 pl-1.5 pr-2 leading-none active:opacity-60"
                >
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
            placeholder={t("miniapp.allowlistAddPlaceholder")}
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

function WordFilterCard({ t, flash }: { t: T; flash: (message: string) => void }) {
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

      <Card>
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
                <span className="flex items-center gap-1.5 max-w-full">
                  <span className="min-w-0 break-all">{word}</span>
                  <button
                    onClick={() => remove(word)}
                    aria-label={t("common.remove")}
                    className="font-bold shrink-0 -my-1.5 -mr-1.5 py-1.5 pl-1.5 pr-2 leading-none active:opacity-60"
                  >
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

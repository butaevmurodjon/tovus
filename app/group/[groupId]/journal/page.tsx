"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { JournalItem } from "@/components/JournalItem";
import { StatusScreen } from "@/components/StatusScreen";
import { haptic, hapticNotify, confirmAction } from "@/lib/miniapp/telegram";
import { PRESET_KEYS, type PresetKey } from "@/lib/moderation/presets";
import type { JournalEntry } from "@/lib/db/types";

const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  agro: "miniapp.presetAgro",
  ecommerce: "miniapp.presetEcommerce",
  edtech: "miniapp.presetEdtech",
  finance: "miniapp.presetFinance",
};

type Tab = "journal" | "whitelist" | "words";

export default function GroupJournalPage() {
  const { t, fetcher } = useApp();
  const [tab, setTab] = useState<Tab>("journal");

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
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
      {tab === "whitelist" && <WhitelistTab t={t} />}
      {tab === "words" && <WordFilterTab t={t} />}
    </div>
  );
}

function JournalTab({
  t,
  fetcher,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  fetcher: <T>(path: string, options?: RequestInit) => Promise<T>;
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

function WhitelistTab({ t }: { t: (key: string, params?: Record<string, string | number>) => string }) {
  const { whitelist, addWhitelistUser, removeWhitelistUser, clearWhitelistAll } = useGroup();
  const [input, setInput] = useState("");

  async function add() {
    const id = Number(input.trim());
    if (!Number.isFinite(id)) return;
    haptic("light");
    setInput("");
    await addWhitelistUser(id);
  }

  async function clearAll() {
    const confirmed = await confirmAction(t("miniapp.confirmDeleteAllWhitelist"));
    if (!confirmed) return;
    haptic("medium");
    await clearWhitelistAll();
  }

  return (
    <Card>
      <CardSection title={t("miniapp.whitelistTitle")} subtitle={t("miniapp.whitelistHint")}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {whitelist.length}
          </span>
          {whitelist.length > 0 && (
            <Button variant="danger" onClick={clearAll}>
              {t("miniapp.deleteAll")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {whitelist.length === 0 && (
            <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              —
            </span>
          )}
          {whitelist.map((id) => (
            <Badge key={id} variant="neutral">
              <span className="flex items-center gap-1.5">
                id{id}
                <button
                  onClick={() => removeWhitelistUser(id)}
                  aria-label={t("common.remove")}
                  className="font-bold"
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

function WordFilterTab({ t }: { t: (key: string, params?: Record<string, string | number>) => string }) {
  const { customWords, addCustomWordEntry, removeCustomWordEntry, clearCustomWordsAll, applyPreset } = useGroup();
  const [input, setInput] = useState("");
  const [applying, setApplying] = useState<PresetKey | null>(null);

  async function add() {
    const word = input.trim();
    if (!word) return;
    haptic("light");
    setInput("");
    await addCustomWordEntry(word);
  }

  async function clearAll() {
    const confirmed = await confirmAction(t("miniapp.confirmDeleteAllWords"));
    if (!confirmed) return;
    haptic("medium");
    await clearCustomWordsAll();
  }

  async function apply(preset: PresetKey) {
    haptic("light");
    setApplying(preset);
    const added = await applyPreset(preset);
    setApplying(null);
    hapticNotify(added > 0 ? "success" : "warning");
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
                  <button
                    onClick={() => removeCustomWordEntry(word)}
                    aria-label={t("common.remove")}
                    className="font-bold"
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

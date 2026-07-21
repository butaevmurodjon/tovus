"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { JournalItem } from "@/components/JournalItem";
import { StatusScreen } from "@/components/StatusScreen";
import { hapticNotify } from "@/lib/miniapp/telegram";
import type { JournalEntry } from "@/lib/db/types";

export default function GroupJournalPage() {
  const { t, fetcher } = useApp();
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
    <div className="px-4 py-4 flex flex-col gap-2.5">
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

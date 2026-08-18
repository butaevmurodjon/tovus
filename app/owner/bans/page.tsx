"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { StatusScreen } from "@/components/StatusScreen";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";
import type { GlobalBanEntry } from "@/lib/db/types";

function formatDate(ts: number, lang: string): string {
  return new Date(ts).toLocaleString(lang === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OwnerBansPage() {
  const { t, lang, fetcher } = useApp();
  const [bans, setBans] = useState<GlobalBanEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [banning, setBanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200);
  }

  function load() {
    fetcher<{ bans: GlobalBanEntry[] }>("/api/miniapp/owner/globalban")
      .then((d) => setBans(d.bans))
      .catch(() => setError(true));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ban() {
    const id = Number(userId.trim());
    if (!Number.isInteger(id) || id <= 0) {
      flash(t("miniapp.ownerInvalidUserId"));
      return;
    }
    const confirmed = await confirmAction(t("miniapp.ownerBanConfirm", { id }));
    if (!confirmed) return;

    haptic("medium");
    setBanning(true);
    try {
      const result = await fetcher<{ bannedGroups: number; totalGroups: number }>(
        "/api/miniapp/owner/globalban",
        { method: "POST", body: JSON.stringify({ userId: id, reason: reason.trim() }) }
      );
      setUserId("");
      setReason("");
      hapticNotify("success");
      flash(t("miniapp.ownerBanDone", { count: result.bannedGroups, total: result.totalGroups }));
      load();
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setBanning(false);
    }
  }

  async function unban(entry: GlobalBanEntry) {
    const confirmed = await confirmAction(t("miniapp.ownerUnbanConfirm", { id: entry.userId }));
    if (!confirmed) return;

    haptic("light");
    setBusyId(entry.userId);
    try {
      await fetcher(`/api/miniapp/owner/globalban?userId=${entry.userId}`, { method: "DELETE" });
      setBans((cur) => cur?.filter((b) => b.userId !== entry.userId) ?? cur);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!bans) return <StatusScreen title={t("common.loading")} />;

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

      <Card>
        <CardSection title={t("miniapp.ownerBanTitle")} subtitle={t("miniapp.ownerBanHint")}>
          <div className="flex flex-col gap-2">
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t("miniapp.ownerUserIdPlaceholder")}
              inputMode="numeric"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("miniapp.ownerReasonPlaceholder")}
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="danger" onClick={ban} disabled={banning}>
              {banning ? t("miniapp.ownerBanning") : t("miniapp.ownerBanEverywhere")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <div className="flex flex-col gap-2">
        {bans.length === 0 && (
          <p className="text-[13px] text-center py-10" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.ownerBanListEmpty")}
          </p>
        )}
        {bans.map((entry) => (
          <Card key={entry.userId} className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                  ID {entry.userId}
                </p>
                {entry.reason && (
                  <p className="text-[12px] mt-0.5 break-words" style={{ color: "var(--ink-secondary)" }}>
                    {entry.reason}
                  </p>
                )}
                <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                  {formatDate(entry.bannedAt, lang)}
                </p>
              </div>
              <Button variant="secondary" onClick={() => unban(entry)} disabled={busyId === entry.userId}>
                {t("miniapp.ownerUnban")}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

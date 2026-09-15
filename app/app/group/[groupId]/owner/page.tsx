"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { Toggle } from "@/components/Toggle";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";
import { ownerActionErrorText } from "@/lib/miniapp/ownerActionErrorText";

type Action = "delete" | "ban" | "unban" | "resetrep";

export default function GroupOwnerPage() {
  const { t, fetcher, isOwner } = useApp();
  const { chatId, settings, digestHubConfigured, refresh } = useGroup();
  const [messageId, setMessageId] = useState("");
  const [userId, setUserId] = useState("");
  const [repUserId, setRepUserId] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Local, optimistic — dailySummaryOwnerAllowed isn't reachable through the
  // group's own PATCH route (see that route's doc comment), so there's no
  // shared GroupProvider state to sync with; seeded once from the settings
  // this page already has.
  const [summaryAllowed, setSummaryAllowed] = useState(settings?.dailySummaryOwnerAllowed ?? false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [applyingPolicy, setApplyingPolicy] = useState(false);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice((current) => (current === text ? null : current)), 2600);
  }

  async function run(action: Action) {
    const raw = action === "delete" ? messageId : action === "resetrep" ? repUserId : userId;
    const value = Number(raw.trim());
    if (!Number.isInteger(value) || value <= 0) {
      flash(action === "delete" ? t("miniapp.groupOwnerInvalidMessageId") : t("miniapp.groupOwnerInvalidUserId"));
      return;
    }
    const title = settings?.title ?? String(chatId);
    const question =
      action === "delete"
        ? t("miniapp.groupOwnerDeleteConfirm", { id: value, title })
        : action === "ban"
          ? t("miniapp.groupOwnerBanConfirm", { id: value, title })
          : action === "unban"
            ? t("miniapp.groupOwnerUnbanConfirm", { id: value, title })
            : t("miniapp.groupOwnerResetConfirm", { id: value, title });
    if (!(await confirmAction(question))) return;

    haptic(action === "ban" ? "medium" : "light");
    setBusy(action);
    try {
      const endpoint = action === "resetrep" ? "resetrep" : action;
      await fetcher(`/api/miniapp/owner/groups/${chatId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(action === "delete" ? { messageId: value } : { userId: value }),
      });
      if (action === "delete") setMessageId("");
      else if (action === "resetrep") setRepUserId("");
      else setUserId("");
      hapticNotify("success");
      flash(
        action === "delete"
          ? t("miniapp.groupOwnerDeletedMsg")
          : action === "ban"
            ? t("miniapp.groupOwnerBannedMsg")
            : action === "unban"
              ? t("miniapp.groupOwnerUnbannedMsg")
              : t("miniapp.groupOwnerResetMsg")
      );
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleDailySummaryAllowed(value: boolean) {
    haptic("light");
    setSummaryBusy(true);
    const previous = summaryAllowed;
    setSummaryAllowed(value); // optimistic — reverted on failure below
    try {
      await fetcher(`/api/miniapp/owner/groups/${chatId}/dailysummary`, {
        method: "POST",
        body: JSON.stringify({ allowed: value }),
      });
      hapticNotify("success");
      flash(value ? t("miniapp.groupOwnerDailySummaryOnMsg") : t("miniapp.groupOwnerDailySummaryOffMsg"));
    } catch (error) {
      setSummaryAllowed(previous);
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setSummaryBusy(false);
    }
  }

  async function applyPolicy() {
    const title = settings?.title ?? String(chatId);
    if (!(await confirmAction(t("miniapp.groupOwnerApplyPolicyConfirm", { title })))) return;
    haptic("medium");
    setApplyingPolicy(true);
    try {
      await fetcher(`/api/miniapp/owner/groups/${chatId}/apply-policy`, {
        method: "POST",
        body: JSON.stringify({ keys: "all" }),
      });
      hapticNotify("success");
      flash(t("miniapp.groupOwnerApplyPolicyDone"));
      refresh();
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setApplyingPolicy(false);
    }
  }

  // The navigation item is already hidden for everyone else. Keeping this guard
  // here also prevents a briefly rendered control if a route is opened directly.
  if (!isOwner) return null;

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      {notice && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium" style={{ background: "var(--ink)", color: "#fff" }}>
          {notice}
        </div>
      )}

      <Card>
        <CardSection title={t("miniapp.groupOwnerBotControlTitle")}>
          <p className="text-[13px] leading-5" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerBotControlHint")}
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.groupOwnerApplyPolicyTitle")}>
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerApplyPolicyHint")}
          </p>
          <Button variant="secondary" onClick={applyPolicy} disabled={applyingPolicy} className="w-full">
            {applyingPolicy ? t("miniapp.groupOwnerApplyPolicyBusy") : t("miniapp.groupOwnerApplyPolicyButton")}
          </Button>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.groupOwnerDailySummaryTitle")}>
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerDailySummaryHint")}
          </p>
          {!digestHubConfigured && (
            <p className="text-[12px] mb-3" style={{ color: "#a3401f" }}>
              {t("miniapp.dailySummaryNotConfiguredHint")}
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[14px]">
              {summaryAllowed ? t("miniapp.groupOwnerDailySummaryAllowed") : t("miniapp.groupOwnerDailySummaryDenied")}
            </span>
            <Toggle
              checked={summaryAllowed}
              onChange={toggleDailySummaryAllowed}
              disabled={summaryBusy || !digestHubConfigured}
            />
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.groupOwnerDeleteMessageTitle")}>
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerDeleteMessageHint")}
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={messageId}
              onChange={(event) => setMessageId(event.target.value)}
              placeholder={t("miniapp.groupOwnerMessageIdPlaceholder")}
              aria-label={t("miniapp.groupOwnerMessageIdPlaceholder")}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
            <Button variant="secondary" onClick={() => run("delete")} disabled={busy !== null}>
              {busy === "delete" ? t("miniapp.groupOwnerDeleting") : t("miniapp.groupOwnerDelete")}
            </Button>
          </div>
        </CardSection>
      </Card>

      {/* Ban and unban share one input+scope — before, unban only existed on
          the global owner/tools resolver (a different screen entirely), so
          undoing a ban made here required knowing that other screen exists. */}
      <Card>
        <CardSection title={t("miniapp.groupOwnerManualBanTitle")}>
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerManualBanHint")}
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder={t("miniapp.groupOwnerUserIdPlaceholder")}
              aria-label={t("miniapp.groupOwnerUserIdPlaceholder")}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
          </div>
          <div className="flex gap-2 mt-2">
            <Button variant="danger" onClick={() => run("ban")} disabled={busy !== null} className="flex-1">
              {busy === "ban" ? t("miniapp.groupOwnerBanning") : t("miniapp.groupOwnerBan")}
            </Button>
            <Button variant="secondary" onClick={() => run("unban")} disabled={busy !== null} className="flex-1">
              {busy === "unban" ? t("miniapp.groupOwnerUnbanning") : t("miniapp.groupOwnerUnban")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.groupOwnerResetRepTitle")}>
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerResetRepHint")}
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={repUserId}
              onChange={(event) => setRepUserId(event.target.value)}
              placeholder={t("miniapp.groupOwnerUserIdPlaceholder")}
              aria-label={t("miniapp.groupOwnerUserIdPlaceholder")}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
            <Button variant="secondary" onClick={() => run("resetrep")} disabled={busy !== null}>
              {busy === "resetrep" ? t("miniapp.groupOwnerResetting") : t("miniapp.groupOwnerReset")}
            </Button>
          </div>
        </CardSection>
      </Card>
    </div>
  );
}

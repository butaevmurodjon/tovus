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
import { MAX_UNBAN_PRICE_STARS as MAX_UNBAN_STARS, MIN_UNBAN_PRICE_STARS as MIN_UNBAN_STARS } from "@/lib/billing/plan";
import type { AppealEntry, JournalEntry } from "@/lib/db/types";

type Tab = "journal" | "appeals";
type T = (key: string, params?: Record<string, string | number>) => string;

// Whitelist / custom words / content allowlist / industry presets used to
// live here as two more tabs — pure configuration under a "Журнал" (log)
// label. Moved to settings/lists (FAANG-audit PR-2); this screen is now
// just the two things that actually ARE a journal: the deletion log and the
// "написать администратору" inbox.
export default function GroupJournalPage() {
  const { t, fetcher, isOwner } = useApp();
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
          className="fixed top-3 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-2rem)] rounded-full px-3.5 py-1.5 text-center text-[12px] font-medium"
          style={{ background: "var(--ink)", color: "#fff" }}
        >
          {toast}
        </div>
      )}
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        columns={2}
        options={[
          { value: "journal", label: t("miniapp.tabJournal") },
          { value: "appeals", label: t("miniapp.tabAppeals") },
        ]}
      />
      {tab === "journal" && <JournalTab t={t} fetcher={fetcher} isOwner={isOwner} flash={flash} />}
      {tab === "appeals" && <AppealsTab t={t} fetcher={fetcher} flash={flash} />}
    </div>
  );
}

function JournalTab({
  t,
  fetcher,
  isOwner,
  flash,
}: {
  t: T;
  fetcher: <R>(path: string, options?: RequestInit) => Promise<R>;
  isOwner: boolean;
  flash: (message: string) => void;
}) {
  const { chatId } = useGroup();
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [banningId, setBanningId] = useState<string | null>(null);
  const [trustingId, setTrustingId] = useState<string | null>(null);

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

  // Labels/confirm/toast here ("Забанить везде" / "во всех группах бота" /
  // "забанен во всех группах" — see ru.json's ownerBanUser/ownerBanConfirm/
  // ownerBannedFromGroup) always promised a bot-wide ban, but this used to
  // POST the single-chat owner ban route, so it only ever banned in the
  // group the journal happened to be open on while telling the owner it was
  // everywhere. Route it through the actual global-ban endpoint (same one
  // app/app/owner/actions/page.tsx uses) so the button does what it says.
  async function ban(entry: JournalEntry) {
    const confirmed = await confirmAction(t("miniapp.ownerBanConfirm", { id: entry.userId }));
    if (!confirmed) return;

    haptic("medium");
    setBanningId(entry.id);
    try {
      await fetcher(`/api/miniapp/owner/globalban`, {
        method: "POST",
        body: JSON.stringify({ userId: entry.userId, reason: `Журнал · ${entry.reason}`.slice(0, 300) }),
      });
      hapticNotify("success");
      flash(t("miniapp.ownerBannedFromGroup"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setBanningId(null);
    }
  }

  async function trust(entry: JournalEntry) {
    const confirmed = await confirmAction(t("miniapp.trustConfirm", { name: entry.displayName }));
    if (!confirmed) return;
    haptic("medium");
    setTrustingId(entry.id);
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/whitelist`, {
        method: "POST",
        body: JSON.stringify({ userId: entry.userId }),
      });
      hapticNotify("success");
      flash(t("miniapp.trustDone"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setTrustingId(null);
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
      kick: t("miniapp.actionKick"),
      ban: t("miniapp.actionBan"),
    },
    restore: t("miniapp.restore"),
    restored: t("miniapp.restored"),
    reasonLabel: t("miniapp.reasonLabel"),
    autoEscalated: t("miniapp.autoEscalatedBadge"),
    ban: t("miniapp.ownerBanUser"),
    trust: t("miniapp.trustAction"),
    signalsLabel: t("miniapp.signalsLabel"),
    signalName: (name: string) => {
      const key = `miniapp.signal_${name}`;
      const translated = t(key);
      return translated === key ? name : translated;
    },
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
          onBan={isOwner ? ban : undefined}
          banning={banningId === entry.id}
          onTrust={trust}
          trusting={trustingId === entry.id}
        />
      ))}
    </div>
  );
}

const APPEAL_STATUS_KEY: Record<AppealEntry["status"], string> = {
  open: "miniapp.appealStatusOpen",
  offer_sent: "miniapp.appealStatusOfferSent",
  resolved: "miniapp.appealStatusResolved",
  dismissed: "miniapp.appealStatusDismissed",
  payment_failed: "miniapp.appealStatusPaymentFailed",
};

/**
 * "Написать администратору" inbox (MONETIZATION.md-adjacent 2026-09-12
 * change) — messages members sent the bot in private after tapping the
 * appeal button on a ban notice or /contact_admin. Three actions: free
 * "Разбанить", "Отклонить", or price a paid unban — there is no auto-punish
 * path here, matching the "never act on this alone" rule the underlying flow
 * already follows. The paid-unban price box carries its own disclaimer
 * (miniapp.appealOfferDisclaimer) because the Stars land on the BOT's own
 * balance, not the admin's — see payments.ts's comment on this.
 */
function AppealsTab({
  t,
  fetcher,
  flash,
}: {
  t: T;
  fetcher: <R>(path: string, options?: RequestInit) => Promise<R>;
  flash: (message: string) => void;
}) {
  const { chatId } = useGroup();
  const [entries, setEntries] = useState<AppealEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [offerInputs, setOfferInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetcher<{ entries: AppealEntry[] }>(`/api/miniapp/groups/${chatId}/appeals`)
      .then((d) => !cancelled && setEntries(d.entries))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [chatId, fetcher]);

  async function act(entry: AppealEntry, action: "unban" | "dismiss" | "offer_paid_unban", amountStars?: number) {
    if (action === "unban") {
      const confirmed = await confirmAction(t("miniapp.appealUnbanConfirm", { name: entry.displayName }));
      if (!confirmed) return;
    }
    if (action === "offer_paid_unban") {
      const confirmed = await confirmAction(
        t("miniapp.appealOfferConfirm", { name: entry.displayName, amount: amountStars ?? 0 })
      );
      if (!confirmed) return;
    }
    haptic("medium");
    setActingId(entry.id);
    try {
      const data = await fetcher<{ entry: AppealEntry }>(`/api/miniapp/groups/${chatId}/appeals/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, amountStars }),
      });
      setEntries((cur) => cur?.map((e) => (e.id === entry.id ? data.entry : e)) ?? cur);
      hapticNotify("success");
      if (action === "unban") flash(t("miniapp.appealUnbanned"));
      if (action === "offer_paid_unban") flash(t("miniapp.appealOfferSent"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setActingId(null);
    }
  }

  function offerAmount(entryId: string): number | null {
    const raw = Number(offerInputs[entryId]);
    return Number.isInteger(raw) && raw >= MIN_UNBAN_STARS && raw <= MAX_UNBAN_STARS ? raw : null;
  }

  if (error) return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!entries) return <StatusScreen title={t("common.loading")} />;

  return (
    <div className="flex flex-col gap-2.5">
      {entries.length === 0 && (
        <p className="text-[13px] text-center py-12" style={{ color: "var(--ink-muted)" }}>
          {t("miniapp.appealsEmpty")}
        </p>
      )}
      {entries.map((entry) => {
        // "payment_failed": the appellant already paid but unbanChatMember
        // itself failed — offer_paid_unban must never show again here (see
        // the route's "already_paid" guard), only retry-unban/dismiss.
        const canOfferPaid = entry.status === "open" || entry.status === "offer_sent";
        const actionable = canOfferPaid || entry.status === "payment_failed";
        const amount = offerAmount(entry.id);
        return (
          <Card key={entry.id}>
            <CardSection>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-[13px] font-medium min-w-0 break-all">
                  {entry.username ? `@${entry.username}` : entry.displayName} · id{entry.userId}
                </span>
                <Badge variant={actionable ? "warning" : "neutral"}>{t(APPEAL_STATUS_KEY[entry.status])}</Badge>
              </div>
              <p className="text-[13px] mb-2 whitespace-pre-wrap break-words" style={{ color: "var(--ink)" }}>
                {entry.text}
              </p>
              <p className="text-[11px] mb-2" style={{ color: "var(--ink-muted)" }}>
                {new Date(entry.createdAt).toLocaleString()}
              </p>
              {entry.status === "offer_sent" && entry.offerStars && (
                <p className="text-[12px] mb-2" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.appealOfferPending", { amount: entry.offerStars })}
                </p>
              )}
              {entry.status === "payment_failed" && (
                <p className="text-[12px] mb-2" style={{ color: "#a3401f" }}>
                  {t("miniapp.appealPaymentFailedHint", { amount: entry.offerStars ?? 0 })}
                </p>
              )}
              {actionable && (
                <>
                  <div className="flex gap-2 mb-2">
                    <Button variant="primary" onClick={() => act(entry, "unban")} disabled={actingId === entry.id}>
                      {t("miniapp.appealUnbanAction")}
                    </Button>
                    <Button variant="secondary" onClick={() => act(entry, "dismiss")} disabled={actingId === entry.id}>
                      {t("miniapp.appealDismissAction")}
                    </Button>
                  </div>
                  {canOfferPaid && (
                    <>
                      <p className="text-[11px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                        {t("miniapp.appealOfferDisclaimer")}
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={offerInputs[entry.id] ?? ""}
                          onChange={(e) => setOfferInputs((cur) => ({ ...cur, [entry.id]: e.target.value }))}
                          placeholder={t("miniapp.appealOfferPlaceholder", {
                            min: MIN_UNBAN_STARS,
                            max: MAX_UNBAN_STARS,
                          })}
                          inputMode="numeric"
                          className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
                          style={{ borderColor: "var(--border-strong)" }}
                        />
                        <Button
                          variant="secondary"
                          onClick={() => amount !== null && act(entry, "offer_paid_unban", amount)}
                          disabled={actingId === entry.id || amount === null}
                        >
                          {t("miniapp.appealOfferAction")}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </CardSection>
          </Card>
        );
      })}
    </div>
  );
}

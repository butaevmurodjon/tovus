"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/contexts/AppProvider";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Toggle } from "@/components/Toggle";
import { StatTile } from "@/components/StatTile";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatusScreen } from "@/components/StatusScreen";
import { Collapsible } from "@/components/Collapsible";
import { AuditLog } from "./AuditLog";
import { formatPlanDate } from "@/lib/billing/plan";
import { haptic, hapticNotify } from "@/lib/miniapp/telegram";
import { ownerActionErrorText } from "@/lib/miniapp/ownerActionErrorText";
import type { OwnerGroupSummary } from "@/lib/db/types";
import type { Lang } from "@/lib/i18n";

const PRO_GRANT_DAYS = [30, 90, 365];

interface OverviewResponse {
  totals: {
    groups: number;
    proGroups: number;
    violationsToday: number;
    joinsToday: number;
    proConversion: number;
    mrrStars: number;
    newGroups7d: number;
    newGroups30d: number;
    churn7d: number | null;
    churn30d: number | null;
  };
  groups: OwnerGroupSummary[];
  digestHubConfigured: boolean;
}

type SortKey = "recent" | "violations" | "joins";

/**
 * FAANG-audit PR-3: this list already existed (search + sort + cards) — the
 * addition is inline owner controls per row (daily-summary toggle, PRO
 * grant/revoke) so flipping either for a group no longer requires the
 * dashboard → group → owner-tab round-trip. Deliberately NOT a new screen:
 * on the actual group count here (single digits), one more list would just
 * be this same list again.
 */
export default function OwnerDashboardPage() {
  const { t, lang, fetcher } = useApp();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  useEffect(() => {
    let cancelled = false;
    fetcher<OverviewResponse>("/api/miniapp/owner/overview")
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  // Both inline controls mutate one group's row in place instead of
  // refetching the whole overview (which also recomputes MRR/conversion —
  // no reason to pay for that just to reflect one toggle).
  function patchGroup(chatId: number, patch: Partial<OwnerGroupSummary>) {
    setData((cur) =>
      cur
        ? {
            ...cur,
            groups: cur.groups.map((g) => (g.chatId === chatId ? { ...g, ...patch } : g)),
          }
        : cur
    );
  }

  const groups = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? data.groups.filter((g) => g.title.toLowerCase().includes(q) || String(g.chatId).includes(q))
      : data.groups;
    const sorted = [...filtered];
    if (sort === "violations") sorted.sort((a, b) => b.violationsToday - a.violationsToday);
    else if (sort === "joins") sorted.sort((a, b) => b.joinsToday - a.joinsToday);
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }, [data, query, sort]);

  if (error) return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!data) return <StatusScreen title={t("common.loading")} />;

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label={t("miniapp.ownerStatGroups")} value={data.totals.groups} accent />
        <StatTile label={t("miniapp.ownerStatPro")} value={data.totals.proGroups} />
        <StatTile label={t("miniapp.ownerStatViolationsToday")} value={data.totals.violationsToday} />
        <StatTile label={t("miniapp.ownerStatJoinsToday")} value={data.totals.joinsToday} />
      </div>

      {/* Second-tier KPIs (revenue/growth detail) tucked behind one tap —
          8 stat tiles in a flat grid gave MRR the same visual weight as
          "violations today", with nothing marking the primary 4 as primary. */}
      <Card className="p-3.5">
        <Collapsible title={t("miniapp.ownerMoreStats")}>
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label={t("miniapp.ownerStatMrr")} value={`${data.totals.mrrStars.toLocaleString("ru-RU")} ⭐`} />
            <StatTile label={t("miniapp.ownerStatConversion")} value={`${data.totals.proConversion}%`} />
            <StatTile
              label={t("miniapp.ownerStatNewGroups")}
              value={`+${data.totals.newGroups7d} / +${data.totals.newGroups30d}`}
            />
            <StatTile
              label={t("miniapp.ownerStatChurn")}
              value={
                data.totals.churn7d === null
                  ? t("miniapp.ownerNoData")
                  : `−${data.totals.churn7d} / −${data.totals.churn30d ?? 0}`
              }
            />
          </div>
        </Collapsible>
      </Card>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("miniapp.ownerSearchPlaceholder")}
        className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
        style={{ borderColor: "var(--border-strong)" }}
      />

      <SegmentedControl<SortKey>
        value={sort}
        onChange={setSort}
        columns={3}
        options={[
          { value: "recent", label: t("miniapp.ownerSortRecent") },
          { value: "violations", label: t("miniapp.ownerSortViolations") },
          { value: "joins", label: t("miniapp.ownerSortJoins") },
        ]}
      />

      <div className="flex flex-col gap-2">
        {groups.length === 0 && (
          <p className="text-[13px] text-center py-10" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.ownerNoGroups")}
          </p>
        )}
        {groups.map((g) => (
          <OwnerGroupRow
            key={g.chatId}
            group={g}
            lang={lang}
            t={t}
            fetcher={fetcher}
            digestHubConfigured={data.digestHubConfigured}
            onPatch={(patch) => patchGroup(g.chatId, patch)}
          />
        ))}
      </div>

      {/* Below the results it's meant to explain, not between the filter and
          them — a search/sort control immediately followed by an unrelated
          audit feed reads as broken filtering. */}
      <AuditLog />
    </div>
  );
}

type T = (key: string, params?: Record<string, string | number>) => string;

function OwnerGroupRow({
  group,
  lang,
  t,
  fetcher,
  digestHubConfigured,
  onPatch,
}: {
  group: OwnerGroupSummary;
  lang: Lang;
  t: T;
  fetcher: <R>(path: string, options?: RequestInit) => Promise<R>;
  digestHubConfigured: boolean;
  onPatch: (patch: Partial<OwnerGroupSummary>) => void;
}) {
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [proBusy, setProBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice((cur) => (cur === text ? null : cur)), 2200);
  }

  async function toggleDailySummary(value: boolean) {
    haptic("light");
    setSummaryBusy(true);
    onPatch({ dailySummaryOwnerAllowed: value }); // optimistic
    try {
      await fetcher(`/api/miniapp/owner/groups/${group.chatId}/dailysummary`, {
        method: "POST",
        body: JSON.stringify({ allowed: value }),
      });
      hapticNotify("success");
    } catch (error) {
      onPatch({ dailySummaryOwnerAllowed: !value });
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setSummaryBusy(false);
    }
  }

  async function grantPro(days: number) {
    haptic("medium");
    setProBusy(true);
    try {
      const res = await fetcher<{ settings: { plan: "pro"; planExpiresAt: number } }>(
        `/api/miniapp/owner/groups/${group.chatId}/pro`,
        { method: "POST", body: JSON.stringify({ action: "grant", days }) }
      );
      onPatch({ plan: "pro", isPro: true, planExpiresAt: res.settings.planExpiresAt });
      hapticNotify("success");
      setProOpen(false);
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setProBusy(false);
    }
  }

  async function revokePro() {
    haptic("medium");
    setProBusy(true);
    try {
      await fetcher(`/api/miniapp/owner/groups/${group.chatId}/pro`, {
        method: "POST",
        body: JSON.stringify({ action: "revoke" }),
      });
      onPatch({ plan: "free", isPro: false, planExpiresAt: null });
      hapticNotify("success");
      setProOpen(false);
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setProBusy(false);
    }
  }

  return (
    <Card className="p-3.5">
      {notice && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          style={{ background: "var(--ink)", color: "#fff" }}
        >
          {notice}
        </div>
      )}
      {/* Link wraps only the navigable header block — the controls below are
          siblings, not nested in it, so tapping the toggle/PRO chip doesn't
          also navigate (that was the actual design risk here, not the API). */}
      <Link href={`/app/group/${group.chatId}/owner`} className="block active:opacity-70 transition-opacity">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-medium truncate" style={{ color: "var(--ink)" }}>
              {group.title || `Chat ${group.chatId}`}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
              ID {group.chatId}
            </p>
          </div>
          <span style={{ color: "var(--ink-muted)" }}>›</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {group.violationsToday > 0 && (
            <Badge variant="warning">
              {t("miniapp.ownerStatViolationsToday")}: {group.violationsToday}
            </Badge>
          )}
          {group.joinsToday > 0 && (
            <Badge variant="good">
              {t("miniapp.ownerStatJoinsToday")}: {group.joinsToday}
            </Badge>
          )}
        </div>
      </Link>

      <div className="h-px my-2.5" style={{ background: "var(--border)" }} />

      <div onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setProOpen((v) => !v)}
          className="flex items-center justify-between w-full py-0.5"
        >
          {group.isPro ? (
            <Badge variant="accent">
              {t("miniapp.planProBadge")} · {formatPlanDate(group.planExpiresAt, lang)}
            </Badge>
          ) : (
            <Badge variant="neutral">{t("miniapp.statusBasic")}</Badge>
          )}
          <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {proOpen ? "▴" : "▾"}
          </span>
        </button>
        {proOpen && (
          <div className="flex flex-wrap gap-2 mt-2">
            {PRO_GRANT_DAYS.map((days) => (
              <Button key={days} variant="secondary" onClick={() => grantPro(days)} disabled={proBusy}>
                {t("miniapp.ownerGrantProDays", { days })}
              </Button>
            ))}
            {group.isPro && (
              <Button variant="danger" onClick={revokePro} disabled={proBusy}>
                {t("miniapp.ownerRevokePro")}
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-2.5">
          <span className="text-[12px]" style={{ color: digestHubConfigured ? "var(--ink-secondary)" : "var(--ink-muted)" }}>
            {t("miniapp.groupOwnerDailySummaryTitle")}
          </span>
          <Toggle
            checked={group.dailySummaryOwnerAllowed}
            onChange={toggleDailySummary}
            disabled={summaryBusy || !digestHubConfigured}
          />
        </div>
      </div>
    </Card>
  );
}

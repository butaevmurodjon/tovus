"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/contexts/AppProvider";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { StatTile } from "@/components/StatTile";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatusScreen } from "@/components/StatusScreen";
import { formatPlanDate } from "@/lib/billing/plan";
import type { OwnerGroupSummary } from "@/lib/db/types";

interface OverviewResponse {
  totals: { groups: number; proGroups: number; violationsToday: number; joinsToday: number };
  groups: OwnerGroupSummary[];
}

type SortKey = "recent" | "violations" | "joins";

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
          <Link key={g.chatId} href={`/group/${g.chatId}`} className="block">
            <Card className="p-3.5 active:opacity-70 transition-opacity">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium truncate" style={{ color: "var(--ink)" }}>
                    {g.title || `Chat ${g.chatId}`}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--ink-muted)" }}>
                    ID {g.chatId}
                  </p>
                </div>
                <span style={{ color: "var(--ink-muted)" }}>›</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {g.isPro ? (
                  <Badge variant="accent">
                    {t("miniapp.planProBadge")} · {formatPlanDate(g.planExpiresAt, lang)}
                  </Badge>
                ) : (
                  <Badge variant="neutral">{t("miniapp.statusBasic")}</Badge>
                )}
                {g.violationsToday > 0 && (
                  <Badge variant="warning">
                    {t("miniapp.ownerStatViolationsToday")}: {g.violationsToday}
                  </Badge>
                )}
                {g.joinsToday > 0 && (
                  <Badge variant="good">
                    {t("miniapp.ownerStatJoinsToday")}: {g.joinsToday}
                  </Badge>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

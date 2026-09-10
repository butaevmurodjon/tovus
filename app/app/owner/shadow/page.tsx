"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatusScreen } from "@/components/StatusScreen";
import { DivergenceSamples } from "./DivergenceSamples";
import type { ShadowStatsBucket } from "@/lib/db/shadowStats";

type Days = "7" | "14" | "30";

interface PerGroupRow {
  chatId: number;
  title: string;
  total: number;
  comparable: number;
  divergence: ShadowStatsBucket["divergence"];
  zone: ShadowStatsBucket["zone"];
}

interface ShadowResponse {
  days: number;
  groupCount: number;
  stats: ShadowStatsBucket;
  perGroup: PerGroupRow[];
  latency: {
    p50Ms: number | null;
    p95Ms: number | null;
    meanMs: number | null;
    budgetMs: number;
    p95WithinBudget: boolean;
  };
  hasData: boolean;
}

export default function OwnerShadowPage() {
  const { t, lang, fetcher } = useApp();
  const [days, setDays] = useState<Days>("7");
  const [data, setData] = useState<ShadowResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetcher<ShadowResponse>(`/api/miniapp/owner/shadow?days=${days}`)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [fetcher, days]);

  function selectDays(d: Days) {
    if (d === days) return;
    setData(null);
    setError(false);
    setDays(d);
  }

  const nf = new Intl.NumberFormat(lang === "uz" ? "uz-UZ" : "ru-RU");
  const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`);
  const latency = (ms: number | null, over: string) =>
    ms === null ? (data?.hasData ? over : "—") : `< ${nf.format(ms)} ${t("miniapp.shadowMs")}`;

  // The three divergence buckets are derived from the cross-tab counters, so
  // their percentages must sum to 100% against their own total — not against
  // `comparable`, which is accumulated from a separate field and can drift
  // above the cross-tab sum for day-buckets written before the current shape.
  const div = data?.stats.divergence;
  const divTotal = div ? div.agree + div.stricter + div.looser : 0;

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <SegmentedControl<Days>
        value={days}
        onChange={selectDays}
        columns={3}
        options={[
          { value: "7", label: t("miniapp.shadowPeriod7") },
          { value: "14", label: t("miniapp.shadowPeriod14") },
          { value: "30", label: t("miniapp.shadowPeriod30") },
        ]}
      />

      {error && <StatusScreen title={t("miniapp.connectionError")} />}
      {!error && !data && <StatusScreen title={t("common.loading")} />}

      {!error && data && !data.hasData && (
        <Card>
          <CardSection title={t("miniapp.shadowTitle")} subtitle={t("miniapp.shadowSubtitle")}>
            <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.shadowNoData")}
            </p>
          </CardSection>
        </Card>
      )}

      {!error && data && data.hasData && (
        <>
          <Card>
            <CardSection title={t("miniapp.shadowTitle")} subtitle={t("miniapp.shadowSubtitle")}>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={data.latency.p95WithinBudget ? "good" : "critical"}>
                  {t("miniapp.shadowLatencyP95")}{" "}
                  {data.latency.p95WithinBudget
                    ? t("miniapp.shadowReady")
                    : t("miniapp.shadowNotReady", { budget: data.latency.budgetMs })}
                </Badge>
                <Badge variant="neutral">
                  {t("miniapp.shadowAgree")} {pct(data.stats.divergence.agree, divTotal)}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                <Metric label={t("miniapp.shadowScored")} value={nf.format(data.stats.total)} />
                <Metric
                  label={t("miniapp.shadowComparable")}
                  value={`${nf.format(data.stats.comparable)} (${pct(data.stats.comparable, data.stats.total)})`}
                />
                <Metric label={t("miniapp.shadowGroupsCovered")} value={nf.format(data.groupCount)} />
                <Metric label={t("miniapp.shadowReputationOnly")} value={nf.format(data.stats.reputationOnlyTrigger)} />
              </dl>
            </CardSection>
          </Card>

          <Card>
            <CardSection title={t("miniapp.shadowZonesTitle")}>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <ZoneTile label={t("miniapp.shadowZoneOk")} value={nf.format(data.stats.zone.ok)} sub={pct(data.stats.zone.ok, data.stats.total)} />
                <ZoneTile label={t("miniapp.shadowZoneWarn")} value={nf.format(data.stats.zone.warn)} sub={pct(data.stats.zone.warn, data.stats.total)} />
                <ZoneTile label={t("miniapp.shadowZoneEscalate")} value={nf.format(data.stats.zone.escalate)} sub={pct(data.stats.zone.escalate, data.stats.total)} />
              </dl>
            </CardSection>
          </Card>

          <Card>
            <CardSection title={t("miniapp.shadowDivergenceTitle")} subtitle={t("miniapp.shadowDivergenceHint")}>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <ZoneTile label={t("miniapp.shadowAgree")} value={nf.format(data.stats.divergence.agree)} sub={pct(data.stats.divergence.agree, divTotal)} />
                <ZoneTile label={t("miniapp.shadowStricter")} value={nf.format(data.stats.divergence.stricter)} sub={pct(data.stats.divergence.stricter, divTotal)} />
                <ZoneTile label={t("miniapp.shadowLooser")} value={nf.format(data.stats.divergence.looser)} sub={pct(data.stats.divergence.looser, divTotal)} />
              </dl>
            </CardSection>
          </Card>

          {data.perGroup.length > 0 && (
            <Card>
              <CardSection title={t("miniapp.shadowPerGroupTitle")} subtitle={t("miniapp.shadowPerGroupHint")}>
                <ul className="flex flex-col">
                  {data.perGroup.map((g, i) => {
                    const rowTotal = g.divergence.agree + g.divergence.stricter + g.divergence.looser;
                    const diverged = g.divergence.stricter + g.divergence.looser;
                    const hot = rowTotal > 0 && diverged / rowTotal >= 0.2;
                    return (
                      <li
                        key={g.chatId}
                        className="py-2 first:pt-0 last:pb-0"
                        style={i === 0 ? undefined : { borderTop: "1px solid var(--border)" }}
                      >
                        <p className="text-[13px] font-medium truncate" style={{ color: "var(--ink)" }}>
                          {g.title}
                        </p>
                        <p
                          className="text-[11px] mt-0.5"
                          style={{ color: "var(--ink-muted)", fontVariantNumeric: "tabular-nums" }}
                        >
                          {nf.format(g.total)} {t("miniapp.shadowPerGroupScored")} · {t("miniapp.shadowAgree")}{" "}
                          {pct(g.divergence.agree, rowTotal)} ·{" "}
                          <span style={{ color: hot ? "var(--status-critical)" : "inherit", fontWeight: hot ? 600 : 400 }}>
                            {t("miniapp.shadowStricter")} {pct(g.divergence.stricter, rowTotal)} · {t("miniapp.shadowLooser")}{" "}
                            {pct(g.divergence.looser, rowTotal)}
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </CardSection>
            </Card>
          )}

          <Card>
            <CardSection
              title={t("miniapp.shadowLatencyTitle")}
              subtitle={t("miniapp.shadowLatencyBudget", { budget: data.latency.budgetMs })}
            >
              <dl className="grid grid-cols-3 gap-2 text-center">
                <ZoneTile
                  label={t("miniapp.shadowLatencyP50")}
                  value={latency(data.latency.p50Ms, t("miniapp.shadowLatencyOverBudget", { budget: data.latency.budgetMs }))}
                  sub=""
                />
                <ZoneTile
                  label={t("miniapp.shadowLatencyP95")}
                  value={latency(data.latency.p95Ms, t("miniapp.shadowLatencyOverBudget", { budget: data.latency.budgetMs }))}
                  sub=""
                />
                <ZoneTile
                  label={t("miniapp.shadowLatencyMean")}
                  value={data.latency.meanMs === null ? "—" : `${nf.format(Math.round(data.latency.meanMs))} ${t("miniapp.shadowMs")}`}
                  sub=""
                />
              </dl>
            </CardSection>
          </Card>
        </>
      )}

      {!error && <DivergenceSamples />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </dt>
      <dd className="font-medium" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </dd>
    </div>
  );
}

function ZoneTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border p-2.5" style={{ borderColor: "var(--border)" }}>
      <dd className="text-[16px] font-semibold leading-none" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </dd>
      {sub && (
        <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
          {sub}
        </p>
      )}
      <dt className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
        {label}
      </dt>
    </div>
  );
}

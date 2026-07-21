"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { BarChart } from "@/components/BarChart";
import { StatusScreen } from "@/components/StatusScreen";
import type { ActivityBucket, DailyStatsPoint } from "@/lib/db/stats";
import type { StatsBucket } from "@/lib/db/types";

type Period = "today" | "7d" | "30d";

interface StatsResponse {
  period: Period;
  summary: StatsBucket;
  daily: DailyStatsPoint[];
  activity: ActivityBucket;
}

export default function GroupStatsPage() {
  const { t, fetcher } = useApp();
  const { chatId } = useGroup();
  const [period, setPeriod] = useState<Period>("7d");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    fetcher<StatsResponse>(`/api/miniapp/groups/${chatId}/stats?period=${period}`)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [chatId, period, fetcher]);

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <SegmentedControl
        value={period}
        onChange={setPeriod}
        options={[
          { value: "today", label: t("miniapp.periodToday") },
          { value: "7d", label: t("miniapp.period7d") },
          { value: "30d", label: t("miniapp.period30d") },
        ]}
      />

      {error && <StatusScreen title={t("miniapp.connectionError")} />}

      {!error && !data && <StatusScreen title={t("common.loading")} />}

      {data && (
        <>
          <Card>
            <CardSection title={t("miniapp.activityTitle")}>
              <div className="grid grid-cols-2 gap-2.5">
                <StatTile label={t("miniapp.activityMessages")} value={data.activity.messages} accent />
                <StatTile label={t("miniapp.activityJoins")} value={data.activity.joins} />
              </div>
            </CardSection>
          </Card>

          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label={t("miniapp.totalRemoved")} value={data.summary.total} accent />
            <StatTile label={t("miniapp.byProfanity")} value={data.summary.profanity} />
            <StatTile label={t("miniapp.bySpam")} value={data.summary.spam} />
            <StatTile label={t("miniapp.byPremium")} value={data.summary.premium} />
          </div>

          <Card>
            <CardSection title={t("miniapp.statsTitle")}>
              {data.daily.every((d) => d.total === 0) ? (
                <p className="text-[13px] py-6 text-center" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.noStats")}
                </p>
              ) : (
                <BarChart
                  data={data.daily}
                  labels={{
                    total: t("miniapp.totalRemoved"),
                    profanity: t("miniapp.byProfanity"),
                    spam: t("miniapp.bySpam"),
                    premium: t("miniapp.byPremium"),
                  }}
                />
              )}
            </CardSection>
          </Card>
        </>
      )}
    </div>
  );
}

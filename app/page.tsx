"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { StatusScreen } from "@/components/StatusScreen";
import { GroupCard } from "@/components/GroupCard";
import type { AdminGroupSummary } from "@/lib/db/types";

export default function DashboardPage() {
  const { status, t, fetcher } = useApp();
  const [groups, setGroups] = useState<AdminGroupSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    fetcher<{ groups: AdminGroupSummary[] }>("/api/miniapp/groups")
      .then((data) => !cancelled && setGroups(data.groups))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [status, fetcher]);

  if (status === "loading") {
    return <StatusScreen title={t("common.loading")} />;
  }
  if (status === "no-telegram") {
    return (
      <StatusScreen
        title={t("miniapp.accessDenied")}
        subtitle="Откройте панель через кнопку в Telegram-боте."
      />
    );
  }
  if (status === "error" || error) {
    return <StatusScreen title={t("miniapp.connectionError")} />;
  }

  return (
    <>
      <TopBar title={t("miniapp.dashboardTitle")} showLangSwitch />
      <main className="flex-1 px-4 py-4">
        <p className="text-[13px] mb-4" style={{ color: "var(--ink-muted)" }}>
          {t("miniapp.dashboardSubtitle")}
        </p>

        {groups === null && <StatusScreen title={t("common.loading")} />}

        {groups !== null && groups.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.noGroups")}
            </p>
          </div>
        )}

        {groups !== null && groups.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {groups.map((g) => (
              <GroupCard
                key={g.chatId}
                group={g}
                labels={{
                  premium: t("miniapp.statusPremium"),
                  basic: t("miniapp.statusBasic"),
                  permissionIssue: t("miniapp.permissionIssueBadge"),
                }}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

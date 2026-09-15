"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { StatusScreen } from "@/components/StatusScreen";
import { GroupCard } from "@/components/GroupCard";
import { Card } from "@/components/Card";
import { Skeleton } from "@/components/Skeleton";
import type { AdminGroupSummary } from "@/lib/db/types";

const START_PARAM_GROUP = /^g(-?\d+)$/;

export default function DashboardPage() {
  const { status, t, fetcher, isOwner, startParam } = useApp();
  const router = useRouter();
  const [groups, setGroups] = useState<AdminGroupSummary[] | null>(null);
  const [error, setError] = useState(false);

  // /panel's deep link (`?startapp=g-1001234567890`) used to land here inert
  // — start_param went nowhere, so the group it was for was invisible and
  // the person had to find it again in the list themselves. `replace`, not
  // `push`: "back" from the group should return to a plain dashboard, not
  // bounce right back into the same redirect.
  const groupIdFromStartParam = startParam?.match(START_PARAM_GROUP)?.[1];
  useEffect(() => {
    if (status === "ready" && groupIdFromStartParam) {
      router.replace(`/app/group/${groupIdFromStartParam}`);
    }
  }, [status, groupIdFromStartParam, router]);

  useEffect(() => {
    if (status !== "ready" || groupIdFromStartParam) return;
    let cancelled = false;
    fetcher<{ groups: AdminGroupSummary[] }>("/api/miniapp/groups")
      .then((data) => !cancelled && setGroups(data.groups))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [status, groupIdFromStartParam, fetcher]);

  // This is the Mini App's entry screen and the only statically prerendered
  // one, so what it renders in the "loading" state is literally the first
  // paint inside Telegram's WebView — before any JS has run. Rendering the
  // real TopBar plus group-card placeholders here (instead of a bare centred
  // "Загрузка…") means the header is already in the HTML and the list fades
  // in underneath it rather than the whole screen re-laying out.
  if (status === "loading" || groupIdFromStartParam) {
    return (
      <>
        <TopBar title={t("miniapp.dashboardTitle")} showLangSwitch />
        <main className="flex-1 px-4 py-4">
          <GroupListSkeleton />
        </main>
      </>
    );
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
          {t(isOwner ? "miniapp.dashboardSubtitleOwner" : "miniapp.dashboardSubtitle")}
        </p>

        {isOwner && (
          <Link href="/app/owner" className="block mb-3">
            <Card className="p-3.5 flex items-center justify-between gap-3 active:opacity-70 transition-opacity">
              <div className="flex items-center gap-2.5">
                <span className="text-[20px] leading-none">🛡</span>
                <div>
                  <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                    {t("miniapp.ownerTitle")}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    {t("miniapp.ownerEntryHint")}
                  </p>
                </div>
              </div>
              <span style={{ color: "var(--accent)" }}>›</span>
            </Card>
          </Link>
        )}

        {groups === null && <GroupListSkeleton />}

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
                  pro: t("miniapp.planProBadge"),
                }}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * Mirrors GroupCard's geometry (Card `p-4`, a 14px title line, a row of 11px
 * badges) so the real list drops in without moving anything. Three rows is the
 * median group count — enough to fill the fold, not so many the page shrinks
 * when the answer is one group.
 */
function GroupListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" role="status" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3.5 w-2/5 mb-2.5" />
          <Skeleton className="h-4 w-24" />
        </Card>
      ))}
    </div>
  );
}

"use client";

import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { OwnerNav } from "@/components/OwnerNav";
import { StatusScreen } from "@/components/StatusScreen";
import { SkeletonScreen } from "@/components/Skeleton";
import { MAIN_PAD_BOTTOM } from "@/components/BottomNav";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { t, status, isOwner } = useApp();

  // Same reasoning as the group layout: the owner header and nav are static,
  // so they paint immediately rather than replacing a bare "Загрузка…" once
  // /api/miniapp/me resolves. Only the content area is unknown at this point.
  if (status === "loading") {
    return (
      <>
        <TopBar title={t("miniapp.ownerTitle")} backHref="/app" />
        <main className="flex-1" style={{ paddingBottom: MAIN_PAD_BOTTOM }}>
          <SkeletonScreen label={t("common.loading")} />
        </main>
        <OwnerNav />
      </>
    );
  }
  if (status === "no-telegram") {
    return <StatusScreen title={t("miniapp.accessDenied")} subtitle="Откройте панель через кнопку в Telegram-боте." />;
  }
  if (status === "error") return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!isOwner) {
    return <StatusScreen title={t("miniapp.accessDenied")} />;
  }

  return (
    <>
      <TopBar title={t("miniapp.ownerTitle")} backHref="/app" />
      <main className="flex-1" style={{ paddingBottom: MAIN_PAD_BOTTOM }}>
        {children}
      </main>
      <OwnerNav />
    </>
  );
}

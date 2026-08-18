"use client";

import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { OwnerNav } from "@/components/OwnerNav";
import { StatusScreen } from "@/components/StatusScreen";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { t, status, isOwner } = useApp();

  if (status === "loading") return <StatusScreen title={t("common.loading")} />;
  if (status === "no-telegram") {
    return <StatusScreen title={t("miniapp.accessDenied")} subtitle="Откройте панель через кнопку в Telegram-боте." />;
  }
  if (status === "error") return <StatusScreen title={t("miniapp.connectionError")} />;
  if (!isOwner) {
    return <StatusScreen title={t("miniapp.accessDenied")} />;
  }

  return (
    <>
      <TopBar title={t("miniapp.ownerTitle")} backHref="/" />
      <main className="flex-1 pb-20">{children}</main>
      <OwnerNav />
    </>
  );
}

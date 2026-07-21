"use client";

import { useParams } from "next/navigation";
import { GroupProvider, useGroup } from "@/contexts/GroupProvider";
import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { BottomNav } from "@/components/BottomNav";
import { StatusScreen } from "@/components/StatusScreen";

function GroupShell({ children }: { children: React.ReactNode }) {
  const { t } = useApp();
  const { status, settings, chatId } = useGroup();

  if (status === "loading") return <StatusScreen title={t("common.loading")} />;
  if (status === "forbidden") {
    return <StatusScreen title={t("miniapp.accessDenied")} subtitle={t("miniapp.notAdminOfGroup")} />;
  }
  if (status === "error" || !settings) {
    return <StatusScreen title={t("miniapp.connectionError")} />;
  }

  return (
    <>
      <TopBar title={settings.title || `Chat ${settings.chatId}`} backHref="/" />
      <main className="flex-1 pb-20">{children}</main>
      <BottomNav chatId={chatId} />
    </>
  );
}

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ groupId: string }>();
  const chatId = Number(params.groupId);

  return (
    <GroupProvider chatId={chatId}>
      <GroupShell>{children}</GroupShell>
    </GroupProvider>
  );
}

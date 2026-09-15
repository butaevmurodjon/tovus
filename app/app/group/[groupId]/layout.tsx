"use client";

import { useParams, usePathname } from "next/navigation";
import { GroupProvider, useGroup } from "@/contexts/GroupProvider";
import { useApp } from "@/contexts/AppProvider";
import { TopBar } from "@/components/TopBar";
import { BottomNav, MAIN_PAD_BOTTOM } from "@/components/BottomNav";
import { StatusScreen } from "@/components/StatusScreen";
import { SkeletonScreen } from "@/components/Skeleton";

// Settings-index row label and subscreen header must be the SAME string
// (Material's settings guidance) — one map serves both SettingsLink (index)
// and this header, so they can never drift apart.
const SETTINGS_SECTION_TITLE_KEY: Record<string, string> = {
  content: "miniapp.sectionProtection",
  entry: "miniapp.sectionEntry",
  punishments: "miniapp.sectionPunishments",
  notifications: "miniapp.sectionChatNotifications",
  lists: "miniapp.sectionLists",
};

function GroupShell({ children }: { children: React.ReactNode }) {
  const { t, isOwner } = useApp();
  const { status, settings, chatId } = useGroup();
  const pathname = usePathname();

  const groupRoot = `/app/group/${chatId}`;
  const settingsPrefix = `${groupRoot}/settings/`;
  const section = pathname?.startsWith(settingsPrefix)
    ? pathname.slice(settingsPrefix.length).split("/")[0]
    : null;
  const sectionTitleKey = section ? SETTINGS_SECTION_TITLE_KEY[section] : null;

  // On a subscreen, "←" goes back up to the settings index — one level, not
  // all the way to the owner dashboard / group list. Everywhere else it's
  // the owner-vs-admin destination from before: the owner almost always
  // arrives here from the owner dashboard's group list (or
  // /app/group/[id]/owner directly), not from "Мои группы" — /app is a
  // near-duplicate of /app/owner for the owner (see DashboardPage), so
  // sending "←" back there instead saves a round-trip through /app.
  const backHref = sectionTitleKey ? groupRoot : isOwner ? "/app/owner" : "/app";

  // Header and nav need no data — only the title does — so they render on the
  // very first paint instead of appearing once the group fetch lands. What
  // used to happen: a centred "Загрузка…" with no chrome, then the whole
  // page re-laid out around a header and a bottom nav that popped in. The
  // skeleton below occupies the same card geometry the real content will.
  if (status === "loading") {
    return (
      <>
        <TopBar title={t("common.loading")} backHref={backHref} />
        <main className="flex-1" style={{ paddingBottom: MAIN_PAD_BOTTOM }}>
          <SkeletonScreen label={t("common.loading")} />
        </main>
        <BottomNav chatId={chatId} />
      </>
    );
  }
  // Terminal states deliberately keep the bare full-screen message: a bottom
  // nav linking deeper into a group the user was just denied (or that failed
  // to load) would only offer three more ways to hit the same wall.
  if (status === "forbidden") {
    return <StatusScreen title={t("miniapp.accessDenied")} subtitle={t("miniapp.notAdminOfGroup")} />;
  }
  if (status === "error" || !settings) {
    return <StatusScreen title={t("miniapp.connectionError")} />;
  }

  return (
    <>
      <TopBar
        title={sectionTitleKey ? t(sectionTitleKey) : settings.title || `Chat ${settings.chatId}`}
        backHref={backHref}
      />
      <main className="flex-1" style={{ paddingBottom: MAIN_PAD_BOTTOM }}>
        {children}
      </main>
      <BottomNav chatId={chatId} />
    </>
  );
}

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ groupId: string }>();
  const { t } = useApp();
  const rawId = params?.groupId;
  // Telegram group and supergroup IDs are negative (for example,
  // -1001234567890). Rejecting the leading minus made every normal group open
  // as a misleading "check your connection" failure.
  const chatId = rawId && /^-?\d+$/.test(rawId) ? Number(rawId) : NaN;

  if (Number.isNaN(chatId)) {
    return <StatusScreen title={t("miniapp.connectionError")} />;
  }

  return (
    <GroupProvider chatId={chatId}>
      <GroupShell>{children}</GroupShell>
    </GroupProvider>
  );
}

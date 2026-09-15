"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";

/**
 * Bottom padding a scrolling `<main>` needs to clear the fixed nav.
 *
 * The nav is ~52px of content PLUS `env(safe-area-inset-bottom)`, which is
 * 34px on every device with a home indicator. `pb-20` (a flat 80px) was
 * therefore ~6px short there and the last row of a settings card sat under
 * the nav bar with no way to scroll it clear. Kept next to the nav itself so
 * the two can't drift apart.
 */
export const MAIN_PAD_BOTTOM = "calc(5rem + env(safe-area-inset-bottom))";

export function BottomNav({ chatId }: { chatId: number }) {
  const pathname = usePathname();
  const { t, isOwner } = useApp();

  const settingsHref = `/app/group/${chatId}`;
  const items = [
    { href: settingsHref, label: t("miniapp.settingsTab"), icon: "⚙" },
    { href: `${settingsHref}/stats`, label: t("miniapp.statsTab"), icon: "▤" },
    { href: `${settingsHref}/journal`, label: t("miniapp.journalTab"), icon: "☰" },
    ...(isOwner ? [{ href: `${settingsHref}/owner`, label: t("miniapp.groupOwnerTab"), icon: "🛡" }] : []),
  ];

  // Longest-matching-href wins, not exact match — otherwise a page with no
  // exact tab (e.g. /app/group/[id]/broadcast, reached from the Settings
  // tab's federation card) highlighted nothing, and settingsHref being a
  // prefix of every other tab's href would otherwise make Settings "active"
  // everywhere if a naive startsWith ran in list order instead.
  const activeHref = [...items].sort((a, b) => b.href.length - a.href.length).find((item) =>
    pathname === item.href || pathname?.startsWith(`${item.href}/`)
  )?.href;

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 inset-x-0 flex items-stretch"
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 min-h-[52px] select-none"
            style={{ color: active ? "var(--accent)" : "var(--ink-muted)" }}
          >
            <span className="text-[16px] leading-none">{item.icon}</span>
            <span className="text-[11px] font-medium leading-tight text-center">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";

export function BottomNav({ chatId }: { chatId: number }) {
  const pathname = usePathname();
  const { t } = useApp();

  const items = [
    { href: `/group/${chatId}`, label: t("miniapp.settingsTab"), icon: "⚙" },
    { href: `/group/${chatId}/stats`, label: t("miniapp.statsTab"), icon: "▤" },
    { href: `/group/${chatId}/journal`, label: t("miniapp.journalTab"), icon: "☰" },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 flex items-stretch"
      style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
            style={{ color: active ? "var(--accent)" : "var(--ink-muted)" }}
          >
            <span className="text-[16px] leading-none">{item.icon}</span>
            <span className="text-[11px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

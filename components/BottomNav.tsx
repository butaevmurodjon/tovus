"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";

export function BottomNav({ chatId }: { chatId: number }) {
  const pathname = usePathname();
  const { t, fetcher, status } = useApp();
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (status !== "ready") return;
    let mounted = true;
    fetcher<{ isOwner: boolean }>("/api/miniapp/me")
      .then((data) => {
        if (mounted) setIsOwner(!!data.isOwner);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [fetcher, status]);

  const items = [
    { href: `/group/${chatId}`, label: t("miniapp.settingsTab"), icon: "⚙" },
    { href: `/group/${chatId}/stats`, label: t("miniapp.statsTab"), icon: "▤" },
    { href: `/group/${chatId}/journal`, label: t("miniapp.journalTab"), icon: "☰" },
    ...(isOwner ? [{ href: "/miniapp/owner", label: "Владелец", icon: "🛡" }] : []),
  ];

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
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex-1 flex flex-col items-center gap-0.5 py-2.5 select-none"
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

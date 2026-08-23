"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";

export function OwnerNav() {
  const pathname = usePathname();
  const { t } = useApp();

  const items = [
    { href: "/owner", label: t("miniapp.ownerNavDashboard"), icon: "🛡" },
    { href: "/owner/bans", label: t("miniapp.ownerNavBans"), icon: "⛔" },
    { href: "/owner/broadcast", label: t("miniapp.ownerNavBroadcast"), icon: "📣" },
    { href: "/owner/tools", label: t("miniapp.ownerNavTools"), icon: "🔧" },
  ];

  return (
    <nav
      aria-label="Owner navigation"
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

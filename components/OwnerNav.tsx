"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/contexts/AppProvider";

export function OwnerNav() {
  const pathname = usePathname();
  const { t } = useApp();

  // "Баны" folded into "Действия" and "Инструменты" renamed to it (FAANG-audit
  // PR-4) — owner/tools and owner/bans merged into one screen at
  // /app/owner/actions, so two tabs became one, freeing a 5th slot — filled
  // now by "Политика" (§5, the deferred item, built once the owner said to
  // go ahead despite the risk).
  const items = [
    { href: "/app/owner", label: t("miniapp.ownerNavDashboard"), icon: "🛡" },
    { href: "/app/owner/shadow", label: t("miniapp.ownerNavShadow"), icon: "🎯" },
    { href: "/app/owner/actions", label: t("miniapp.ownerNavActions"), icon: "🔧" },
    { href: "/app/owner/policy", label: t("miniapp.ownerNavPolicy"), icon: "📐" },
    { href: "/app/owner/broadcast", label: t("miniapp.ownerNavBroadcast"), icon: "📣" },
  ];

  // Longest-matching-href wins — "/app/owner" would otherwise prefix-match
  // every other tab's href if compared in list order (see BottomNav's same
  // fix for the identical shape of bug).
  const activeHref = [...items].sort((a, b) => b.href.length - a.href.length).find((item) =>
    pathname === item.href || pathname?.startsWith(`${item.href}/`)
  )?.href;

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

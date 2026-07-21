"use client";

import Link from "next/link";
import { useApp } from "@/contexts/AppProvider";
import type { Lang } from "@/lib/i18n";

export function TopBar({
  title,
  backHref,
  showLangSwitch = false,
}: {
  title: string;
  backHref?: string;
  showLangSwitch?: boolean;
}) {
  const { lang, setLang, t } = useApp();

  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3"
      style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {backHref && (
          <Link
            href={backHref}
            aria-label={t("common.back")}
            className="shrink-0 flex items-center justify-center h-7 w-7 rounded-full"
            style={{ color: "var(--ink-secondary)" }}
          >
            ←
          </Link>
        )}
        <h1 className="text-[16px] font-semibold truncate" style={{ color: "var(--ink)" }}>
          {title}
        </h1>
      </div>
      {showLangSwitch && <LangSwitch lang={lang} onChange={setLang} />}
    </header>
  );
}

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  return (
    <div className="inline-flex rounded-full p-0.5 shrink-0" style={{ background: "#f2f1ee" }}>
      {(["ru", "uz"] as Lang[]).map((code) => {
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            onClick={() => onChange(code)}
            className="rounded-full px-2.5 py-1 text-[12px] font-semibold uppercase transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#fff" : "var(--ink-muted)",
            }}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}

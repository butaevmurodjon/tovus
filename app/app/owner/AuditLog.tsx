"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Collapsible } from "@/components/Collapsible";
import type { OwnerAuditEntry } from "@/lib/db/auditLog";

function formatTime(ts: number, lang: string): string {
  return new Date(ts).toLocaleString(lang === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditLog() {
  const { t, lang, fetcher } = useApp();
  const [entries, setEntries] = useState<OwnerAuditEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetcher<{ entries: OwnerAuditEntry[] }>("/api/miniapp/owner/audit?limit=20")
      .then((d) => !cancelled && setEntries(d.entries))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  // Deliberately silent on load/error: this is a secondary glance panel on a
  // page that already surfaces a connection error of its own. (DivergenceSamples
  // shows an inline error card because it's the whole point of its screen.)
  if (error || !entries) return null;

  return (
    <Card>
      <CardSection>
        <Collapsible title={t("miniapp.auditTitle")}>
          {entries.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.auditEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {entries.map((e) => {
                const actionKey = `miniapp.audit_${e.action}`;
                const action = t(actionKey);
                return (
                  <li
                    key={e.id}
                    className="rounded-[var(--radius-sm)] border p-2.5"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                        {action === actionKey ? e.action : action}
                      </span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--ink-muted)" }}>
                        {formatTime(e.ts, lang)}
                      </span>
                    </div>
                    <p className="text-[12px] mt-0.5 break-words" style={{ color: "var(--ink-secondary)" }}>
                      {e.target}
                    </p>
                    {e.detail && (
                      <p className="text-[12px] mt-0.5 break-words" style={{ color: "var(--ink-muted)" }}>
                        «{e.detail}»
                      </p>
                    )}
                    <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                      {t("miniapp.auditActor")} {e.actorId}
                      {e.outcome ? ` · ${e.outcome}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Collapsible>
      </CardSection>
    </Card>
  );
}

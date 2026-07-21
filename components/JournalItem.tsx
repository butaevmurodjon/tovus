"use client";

import { Card } from "./Card";
import { Badge, type BadgeVariant } from "./Badge";
import { Button } from "./Button";
import type { JournalEntry } from "@/lib/db/types";

const CATEGORY_VARIANT: Record<JournalEntry["category"], BadgeVariant> = {
  profanity: "serious",
  spam: "warning",
  premium: "accent",
};

const ACTION_VARIANT: Record<JournalEntry["action"], BadgeVariant> = {
  delete: "neutral",
  warn: "warning",
  mute: "serious",
  ban: "critical",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function JournalItem({
  entry,
  labels,
  onRestore,
  restoring,
}: {
  entry: JournalEntry;
  labels: {
    category: Record<JournalEntry["category"], string>;
    action: Record<JournalEntry["action"], string>;
    restore: string;
    restored: string;
    reasonLabel: string;
  };
  onRestore: (id: string) => void;
  restoring: boolean;
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant={CATEGORY_VARIANT[entry.category]}>{labels.category[entry.category]}</Badge>
          <Badge variant={ACTION_VARIANT[entry.action]}>{labels.action[entry.action]}</Badge>
        </div>
        <span className="text-[11px] shrink-0" style={{ color: "var(--ink-muted)" }}>
          {formatTime(entry.timestamp)}
        </span>
      </div>

      <p className="text-[13px] font-medium mb-0.5" style={{ color: "var(--ink)" }}>
        {entry.displayName}
      </p>
      {entry.text && (
        <p className="text-[13px] mb-1.5 break-words" style={{ color: "var(--ink-secondary)" }}>
          {entry.text}
        </p>
      )}
      <p className="text-[11px] mb-3" style={{ color: "var(--ink-muted)" }}>
        {labels.reasonLabel}: {entry.reason}
      </p>

      {entry.restored ? (
        <Badge variant="good">{labels.restored}</Badge>
      ) : (
        <Button variant="secondary" onClick={() => onRestore(entry.id)} disabled={restoring}>
          {labels.restore}
        </Button>
      )}
    </Card>
  );
}

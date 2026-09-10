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
  onBan,
  banning,
  onTrust,
  trusting,
}: {
  entry: JournalEntry;
  labels: {
    category: Record<JournalEntry["category"], string>;
    action: Record<JournalEntry["action"], string>;
    restore: string;
    restored: string;
    reasonLabel: string;
    autoEscalated: string;
    ban?: string;
    /** "Больше не наказывать" — adds the user to the group whitelist. */
    trust?: string;
    /** §10.1.1 "почему сработало" — weighted signal breakdown. */
    signalsLabel: string;
    /** Internal signal name -> human label; falls back to the raw name. */
    signalName: (name: string) => string;
  };
  onRestore: (id: string) => void;
  restoring: boolean;
  /** Owner-only: bans this entry's user across every group the bot manages. Omitted for non-owners. */
  onBan?: (entry: JournalEntry) => void;
  banning?: boolean;
  /** Any group admin: whitelists this entry's user so the bot stops moderating
   * their messages in this group. */
  onTrust?: (entry: JournalEntry) => void;
  trusting?: boolean;
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant={CATEGORY_VARIANT[entry.category]}>{labels.category[entry.category]}</Badge>
          <Badge variant={ACTION_VARIANT[entry.action]}>{labels.action[entry.action]}</Badge>
          {entry.escalated && <Badge variant="warning">{labels.autoEscalated}</Badge>}
        </div>
        <span className="text-[11px] shrink-0" style={{ color: "var(--ink-muted)" }}>
          {formatTime(entry.timestamp)}
        </span>
      </div>

      {/* break-words on both of these for the same reason the message text
          below already had it: a display name can be a single unbroken run of
          characters (no spaces at all is common for spam accounts) and the
          reason string can carry a bare URL — either one overflowed the card. */}
      <p className="text-[13px] font-medium mb-0.5 break-words" style={{ color: "var(--ink)" }}>
        {entry.displayName}
      </p>
      {entry.text && (
        <p className="text-[13px] mb-1.5 break-words" style={{ color: "var(--ink-secondary)" }}>
          {entry.text}
        </p>
      )}
      <p className="text-[11px] mb-1.5 break-words" style={{ color: "var(--ink-muted)" }}>
        {labels.reasonLabel}: {entry.reason}
      </p>

      {/* Rendered only when the content re-derivation actually produced signals
          — empty is normal for profanity/flood/etc. and would read as "flagged
          for nothing" (see JournalEntry.score). */}
      {entry.signals && entry.signals.length > 0 && (
        <div className="mb-3 rounded-[var(--radius-sm)] px-2.5 py-2" style={{ background: "#f7f6f3" }}>
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--ink-muted)" }}>
            {labels.signalsLabel}
          </p>
          <ul className="flex flex-col gap-0.5">
            {[...entry.signals]
              .sort((a, b) => b.weight - a.weight)
              .map((s, i) => (
                <li
                  key={`${s.name}-${i}`}
                  className="flex items-baseline justify-between gap-2 text-[12px]"
                  style={{ color: "var(--ink-secondary)" }}
                >
                  <span className="break-words">{labels.signalName(s.name)}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-muted)" }}>
                    +{s.weight}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {entry.restored ? (
          <Badge variant="good">{labels.restored}</Badge>
        ) : (
          <Button variant="secondary" onClick={() => onRestore(entry.id)} disabled={restoring}>
            {labels.restore}
          </Button>
        )}
        {onTrust && labels.trust && (
          <Button variant="secondary" onClick={() => onTrust(entry)} disabled={trusting}>
            {labels.trust}
          </Button>
        )}
        {onBan && labels.ban && (
          <Button variant="danger" onClick={() => onBan(entry)} disabled={banning}>
            {labels.ban}
          </Button>
        )}
      </div>
    </Card>
  );
}

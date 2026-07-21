"use client";

import { useState } from "react";
import type { DailyStatsPoint } from "@/lib/db/stats";

function formatDayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

export function BarChart({
  data,
  labels,
}: {
  data: DailyStatsPoint[];
  labels: { total: string; profanity: string; spam: string; premium: string };
}) {
  const lastIndex = data.length - 1;
  const [selected, setSelected] = useState<number>(lastIndex);
  const max = Math.max(1, ...data.map((d) => d.total));
  const point = data[selected] ?? data[lastIndex];

  return (
    <div>
      {point && (
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {formatDayLabel(point.date)}
          </span>
          <div className="flex gap-3 text-[12px]" style={{ color: "var(--ink-secondary)" }}>
            <span>
              {labels.total}: <strong style={{ color: "var(--ink)" }}>{point.total}</strong>
            </span>
          </div>
        </div>
      )}

      <div
        className="flex items-end gap-[2px]"
        style={{ height: 96, borderBottom: "1px solid var(--border-strong)" }}
        role="img"
        aria-label={labels.total}
      >
        {data.map((d, i) => {
          const h = d.total === 0 ? 2 : Math.max(4, Math.round((d.total / max) * 92));
          const active = i === selected;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelected(i)}
              className="flex-1 h-full flex flex-col justify-end group"
              aria-label={`${formatDayLabel(d.date)}: ${d.total}`}
            >
              <span
                className="block w-full rounded-t-[4px] transition-colors"
                style={{
                  height: h,
                  background: active ? "var(--accent-strong)" : "var(--accent)",
                  opacity: active ? 1 : 0.55,
                }}
              />
            </button>
          );
        })}
      </div>

      <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
        <span>{data[0] ? formatDayLabel(data[0].date) : ""}</span>
        <span>{data[lastIndex] ? formatDayLabel(data[lastIndex].date) : ""}</span>
      </div>

      {point && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <BreakdownItem label={labels.profanity} value={point.profanity} />
          <BreakdownItem label={labels.spam} value={point.spam} />
          <BreakdownItem label={labels.premium} value={point.premium} />
        </div>
      )}
    </div>
  );
}

function BreakdownItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-[15px] font-semibold" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
    </div>
  );
}

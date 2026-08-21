"use client";

import type { HourlyActivityPoint } from "@/lib/db/stats";

/** Single-series 24-bar distribution (message count by UTC hour) — the peak
 * hour(s) get the accent-strong highlight, everything else the muted accent,
 * mirroring BarChart's active/inactive mark spec (see components/BarChart.tsx)
 * but driven by magnitude instead of click-selection: there's nothing to
 * select here, just a shape to read at a glance. */
export function HourlyActivityChart({ data, label }: { data: HourlyActivityPoint[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div>
      <div
        className="flex items-end gap-[2px]"
        style={{ height: 96, borderBottom: "1px solid var(--border-strong)" }}
        role="img"
        aria-label={label}
      >
        {data.map((d) => {
          const h = d.count === 0 ? 2 : Math.max(4, Math.round((d.count / max) * 92));
          // max > 1 avoids every hour lighting up as "peak" on sparse/early
          // data where several hours are all tied at count 1.
          const isPeak = d.count > 0 && d.count === max && max > 1;
          return (
            <div key={d.hour} className="flex-1 h-full flex flex-col justify-end" aria-label={`${d.hour}:00 — ${d.count}`}>
              <span
                className="block w-full rounded-t-[4px]"
                style={{
                  height: h,
                  background: isPeak ? "var(--accent-strong)" : "var(--accent)",
                  opacity: isPeak ? 1 : 0.55,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[10px]" style={{ color: "var(--ink-muted)" }}>
        <span>0:00</span>
        <span>12:00</span>
        <span>23:00</span>
      </div>
    </div>
  );
}

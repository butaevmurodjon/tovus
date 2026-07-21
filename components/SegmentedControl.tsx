"use client";

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Grid columns per row. Defaults to one row (options.length) — pass e.g. 2 to wrap
   * a longer option set (like the 4-way violation-action picker) into a fixed grid
   * instead of letting content width decide, which wrapped inconsistently. */
  columns?: number;
}) {
  return (
    <div
      className="grid w-full rounded-[var(--radius-sm)] p-0.5 gap-0.5"
      style={{ background: "#f2f1ee", gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className="rounded-[7px] px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--ink)" : "var(--ink-muted)",
              boxShadow: active ? "0 1px 2px rgba(11,11,11,0.08)" : "none",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

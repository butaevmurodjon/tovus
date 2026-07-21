export function StatTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] border p-3.5"
      style={{ borderColor: "var(--border)", background: accent ? "var(--accent-wash)" : "var(--surface)" }}
    >
      <p
        className="text-[22px] font-semibold leading-none mb-1.5"
        style={{ color: accent ? "var(--accent-strong)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}
      >
        {value.toLocaleString("ru-RU")}
      </p>
      <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </p>
    </div>
  );
}

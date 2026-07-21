export function StatusScreen({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
        {title}
      </p>
      {subtitle && (
        <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[var(--radius-md)] bg-[var(--surface)] border ${className}`}
      style={{ borderColor: "var(--border)" }}
    >
      {children}
    </div>
  );
}

export function CardSection({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`p-4 ${className}`}>
      {title && <h3 className="text-[13px] font-semibold mb-0.5" style={{ color: "var(--ink)" }}>{title}</h3>}
      {subtitle && (
        <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

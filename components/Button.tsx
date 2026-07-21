"use client";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: Variant;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const styles: Record<Variant, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "#fff" },
    secondary: { background: "#f2f1ee", color: "var(--ink)" },
    ghost: { background: "transparent", color: "var(--accent-strong)" },
    danger: { background: "var(--status-critical-wash)", color: "#a12a2a" },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-[var(--radius-sm)] px-4 py-2.5 text-[14px] font-medium transition-opacity disabled:opacity-40 active:opacity-80 ${className}`}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

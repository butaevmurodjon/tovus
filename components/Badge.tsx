export type BadgeVariant = "neutral" | "accent" | "good" | "warning" | "serious" | "critical";

const VARIANT_STYLES: Record<BadgeVariant, { bg: string; fg: string }> = {
  neutral: { bg: "#f2f1ee", fg: "var(--ink-secondary)" },
  accent: { bg: "var(--accent-wash)", fg: "var(--accent-strong)" },
  good: { bg: "var(--status-good-wash)", fg: "#0a7a0a" },
  warning: { bg: "var(--status-warning-wash)", fg: "#8a5c00" },
  serious: { bg: "var(--status-serious-wash)", fg: "#a3401f" },
  critical: { bg: "var(--status-critical-wash)", fg: "#a12a2a" },
};

export function Badge({ children, variant = "neutral" }: { children: React.ReactNode; variant?: BadgeVariant }) {
  const style = VARIANT_STYLES[variant];
  return (
    <span
      // max-w-full so a badge whose content is a single long token — an
      // allowlisted domain or a custom word in the journal's chip lists — is
      // capped by its container and wraps, instead of pushing the row wider
      // than the viewport.
      className="inline-flex items-center max-w-full rounded-full px-2 py-0.5 text-[11px] font-medium leading-normal"
      style={{ background: style.bg, color: style.fg }}
    >
      {children}
    </span>
  );
}

"use client";

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full transition-colors disabled:opacity-40"
      style={{ background: checked ? "var(--accent)" : "var(--border-strong)" }}
    >
      <span
        className="inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(23px)" : "translateX(3px)" }}
      />
    </button>
  );
}

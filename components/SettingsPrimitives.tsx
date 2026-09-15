"use client";

import { FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";

/**
 * Shared building blocks for the group settings subscreens
 * (app/app/group/[groupId]/settings/*). Pulled out of the old single
 * settings page when it split into an index + subscreens (FAANG-audit
 * PR-1) — every subscreen needs these, so they live here instead of being
 * re-copied per file.
 */

export function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    // gap-3 + min-w-0: the label is free to wrap (several are long enough to
    // on a 320px screen), and justify-between alone left a wrapped last line
    // butting straight against the toggle with no gutter.
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[14px] min-w-0" style={{ color: "var(--ink)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="h-px" style={{ background: "var(--border)" }} />;
}

/** For a sub-block inside a CardSection that reads as its own titled group
 * of controls (e.g. "Наказания" bundles three of these) — mirrors
 * CardSection's own title/subtitle classes exactly, so grouping controls
 * inside one card doesn't visually demote what reads as a section heading
 * down to a plain muted field label. */
export function SubLabel({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <>
      <p className={`text-[13px] font-semibold ${subtitle ? "mb-0.5" : "mb-1.5"}`} style={{ color: "var(--ink)" }}>
        {children}
      </p>
      {subtitle && (
        <p className="text-[12px] mb-2" style={{ color: "var(--ink-muted)" }}>
          {subtitle}
        </p>
      )}
    </>
  );
}

export function ProFeatureHint({
  eligible,
  enabled,
  normalHint,
  t,
  className = "",
}: {
  eligible: boolean;
  enabled: boolean;
  normalHint: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  className?: string;
}) {
  if (eligible) {
    return (
      <p className={`text-[12px] mt-1 ${className}`} style={{ color: "var(--ink-muted)" }}>
        {normalHint}
      </p>
    );
  }
  // Distinct from the plain "locked" case: this setting is ON in storage but not
  // currently being enforced (group outgrew the free tier / subscription lapsed) —
  // silently doing nothing here would be confusing, since the toggle still shows "on".
  if (enabled) {
    return (
      <p className={`text-[12px] mt-1 ${className}`} style={{ color: "#a3401f" }}>
        {t("miniapp.proNotEnforcedHint", { limit: FREE_TIER_MAX_MEMBERS })}
      </p>
    );
  }
  return (
    <p className={`text-[12px] mt-1 ${className}`} style={{ color: "var(--ink-muted)" }}>
      {t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS })}
    </p>
  );
}

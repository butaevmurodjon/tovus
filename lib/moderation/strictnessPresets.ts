import type { GroupSettings } from "@/lib/db/types";

/**
 * One-tap starting point for the handful of settings that most directly
 * control how aggressively the bot reacts (§6.5 priority 5) — same spirit as
 * the word-list presets in presets.ts: a reviewable starting combination, not
 * a locked mode. Deliberately excludes:
 *  - Pro-gated fields (captchaEnabled/antiraidEnabled/federationEnabled), so
 *    applying a preset never gets silently stripped on a free-tier group
 *    (see the PATCH route's `rejected` handling);
 *  - nightMode/logChannel/welcome/voteBanThreshold, which depend on
 *    per-group specifics (timezone, a channel id, wording, community size)
 *    that a strictness label can't guess.
 * `warnTtlDays` IS included, unlike the other warn-escalation fields' sibling
 * `voteBanThreshold` — leaving it untouched would let a group's pre-existing
 * value silently change what "N warns" in a preset's label actually means.
 */
export type StrictnessLevel = "mild" | "balanced" | "strict";

export const STRICTNESS_LEVELS: StrictnessLevel[] = ["mild", "balanced", "strict"];

export type StrictnessFields = Pick<
  GroupSettings,
  | "profanityFilter"
  | "antispam"
  | "casCheckEnabled"
  | "action"
  | "warnEscalationEnabled"
  | "warnLimit"
  | "warnTtlDays"
  | "warnAction"
  | "restrictNewMembersEnabled"
  | "restrictNewMembersMinutes"
>;

export const STRICTNESS_PRESETS: Record<StrictnessLevel, StrictnessFields> = {
  // Delete quietly first, escalate slowly — for communities that would rather
  // eat a few false positives than lose a real member over one warning.
  mild: {
    profanityFilter: true,
    antispam: true,
    casCheckEnabled: true,
    action: "warn",
    warnEscalationEnabled: true,
    warnLimit: 5,
    warnTtlDays: 7,
    warnAction: "mute",
    restrictNewMembersEnabled: false,
    restrictNewMembersMinutes: 10,
  },
  // The recommended middle ground — deliberately turns on the two protections
  // that default to *off* even for a brand-new group (warnEscalationEnabled,
  // restrictNewMembersEnabled are opt-in by design, see types.ts) alongside
  // the same delete/mute/3-warns/7-day posture DEFAULT_GROUP_SETTINGS already
  // has. Applying this to a fresh, untouched group is not a no-op.
  balanced: {
    profanityFilter: true,
    antispam: true,
    casCheckEnabled: true,
    action: "delete",
    warnEscalationEnabled: true,
    warnLimit: 3,
    warnTtlDays: 7,
    warnAction: "mute",
    restrictNewMembersEnabled: true,
    restrictNewMembersMinutes: 10,
  },
  // Immediate mute (not just delete) on any hit, fast escalation to ban, and
  // a longer new-member lockdown — for groups actively fighting a raid/spam
  // wave. The wider 14-day TTL is deliberate, not an oversight: with a limit
  // of just 2, a *narrower* window would make escalation harder to reach
  // (needs two hits close together) — the opposite of what "strict" promises.
  strict: {
    profanityFilter: true,
    antispam: true,
    casCheckEnabled: true,
    action: "mute",
    warnEscalationEnabled: true,
    warnLimit: 2,
    warnTtlDays: 14,
    warnAction: "ban",
    restrictNewMembersEnabled: true,
    restrictNewMembersMinutes: 30,
  },
};

const STRICTNESS_KEYS = Object.keys(STRICTNESS_PRESETS.balanced) as (keyof StrictnessFields)[];

/**
 * Null when the group's current settings don't exactly match any preset (e.g.
 * after a manual tweak to one field) — the Mini App shows no picker selection
 * rather than lying about which preset is "active".
 */
export function detectStrictnessLevel(settings: GroupSettings): StrictnessLevel | null {
  for (const level of STRICTNESS_LEVELS) {
    const preset = STRICTNESS_PRESETS[level];
    const matches = STRICTNESS_KEYS.every((key) => {
      // restrictNewMembersMinutes is inert whenever the restriction itself is
      // off in both the preset and the group's actual settings — comparing it
      // then would let an unused leftover number (e.g. set via /restrictnew
      // while the toggle used to be on) block an otherwise-exact match.
      if (
        key === "restrictNewMembersMinutes" &&
        !preset.restrictNewMembersEnabled &&
        !settings.restrictNewMembersEnabled
      ) {
        return true;
      }
      return settings[key] === preset[key];
    });
    if (matches) return level;
  }
  return null;
}

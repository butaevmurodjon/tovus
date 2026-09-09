import { describe, expect, it } from "vitest";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/lib/db/types";
import { STRICTNESS_LEVELS, STRICTNESS_PRESETS, detectStrictnessLevel } from "./strictnessPresets";

function settingsWith(patch: Partial<GroupSettings>): GroupSettings {
  return {
    ...DEFAULT_GROUP_SETTINGS,
    chatId: -1,
    title: "test",
    createdAt: 0,
    lang: "ru",
    ...patch,
  };
}

describe("strictnessPresets", () => {
  it("declares a distinct preset for every level", () => {
    for (const level of STRICTNESS_LEVELS) {
      expect(STRICTNESS_PRESETS[level]).toBeDefined();
    }
  });

  it("detects each preset from a matching settings object", () => {
    for (const level of STRICTNESS_LEVELS) {
      const settings = settingsWith(STRICTNESS_PRESETS[level]);
      expect(detectStrictnessLevel(settings)).toBe(level);
    }
  });

  it("returns null when settings don't exactly match any preset", () => {
    const settings = settingsWith({ ...STRICTNESS_PRESETS.balanced, warnLimit: 4 });
    expect(detectStrictnessLevel(settings)).toBeNull();
  });

  it("tolerates a leftover restrictNewMembersMinutes value while the restriction is off", () => {
    // "mild" ships restrictNewMembersEnabled: false — a group that once set
    // minutes to 30 via /restrictnew while the toggle was on, then turned it
    // off, still reads as mild: the number is inert either way.
    const settings = settingsWith({ ...STRICTNESS_PRESETS.mild, restrictNewMembersMinutes: 30 });
    expect(detectStrictnessLevel(settings)).toBe("mild");
  });

  it("still requires an exact match once the restriction is actually on", () => {
    const settings = settingsWith({ ...STRICTNESS_PRESETS.balanced, restrictNewMembersMinutes: 30 });
    expect(detectStrictnessLevel(settings)).toBeNull();
  });

  it("reads a brand-new group's untouched defaults as no preset", () => {
    // warnEscalationEnabled/restrictNewMembersEnabled default to off (opt-in
    // by design), which no preset leaves both off — a fresh group is "custom"
    // until an admin actually picks one, not silently "balanced".
    expect(detectStrictnessLevel(settingsWith({}))).toBeNull();
  });

  it("never touches Pro-gated or per-group-specific fields", () => {
    for (const level of STRICTNESS_LEVELS) {
      const preset = STRICTNESS_PRESETS[level] as Partial<GroupSettings>;
      expect(preset.captchaEnabled).toBeUndefined();
      expect(preset.antiraidEnabled).toBeUndefined();
      expect(preset.federationEnabled).toBeUndefined();
      expect(preset.nightModeEnabled).toBeUndefined();
      expect(preset.voteBanThreshold).toBeUndefined();
    }
  });
});

import { describe, expect, it } from "vitest";
import { applyAntiraidCascade, applyWarnLimitCascade } from "./groups";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "./types";

const baseSettings: GroupSettings = {
  chatId: 1,
  title: "test",
  createdAt: 0,
  lang: "ru",
  ...DEFAULT_GROUP_SETTINGS,
};

describe("applyAntiraidCascade", () => {
  it("clears antiraidAuto when antiraidEnabled is explicitly turned off (regression)", () => {
    expect(applyAntiraidCascade(baseSettings, { antiraidEnabled: false })).toEqual({
      antiraidEnabled: false,
      antiraidAuto: false,
    });
  });

  it("does not touch antiraidAuto when antiraidEnabled is turned on", () => {
    expect(applyAntiraidCascade(baseSettings, { antiraidEnabled: true })).toEqual({ antiraidEnabled: true });
  });

  it("leaves unrelated patches untouched", () => {
    expect(applyAntiraidCascade(baseSettings, { profanityFilter: false })).toEqual({ profanityFilter: false });
  });

  it("does not clobber an explicit antiraidAuto value already in the same patch", () => {
    // Not a real caller today, but the cascade should never silently override
    // a value the caller itself already set for the same key.
    expect(applyAntiraidCascade(baseSettings, { antiraidEnabled: false, antiraidAuto: false })).toEqual({
      antiraidEnabled: false,
      antiraidAuto: false,
    });
  });
});

describe("applyWarnLimitCascade", () => {
  it("clears warnEscalationEnabled when the limit is explicitly set to 0 (regression)", () => {
    expect(applyWarnLimitCascade(baseSettings, { warnLimit: 0 })).toEqual({
      warnLimit: 0,
      warnEscalationEnabled: false,
    });
  });

  it("does not touch warnEscalationEnabled for a non-zero limit", () => {
    expect(applyWarnLimitCascade(baseSettings, { warnLimit: 5 })).toEqual({ warnLimit: 5 });
  });

  it("leaves unrelated patches untouched when the stored limit is non-zero", () => {
    expect(applyWarnLimitCascade(baseSettings, { profanityFilter: false })).toEqual({ profanityFilter: false });
  });

  it("clears warnEscalationEnabled when re-enabled without a limit while 0 is already stored (regression)", () => {
    const stored = { ...baseSettings, warnLimit: 0 };
    expect(applyWarnLimitCascade(stored, { warnEscalationEnabled: true })).toEqual({
      warnEscalationEnabled: false,
    });
  });
});

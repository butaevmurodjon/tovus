import { describe, expect, it } from "vitest";
import { applyAntiraidCascade, applyWarnLimitCascade } from "./groups";

describe("applyAntiraidCascade", () => {
  it("clears antiraidAuto when antiraidEnabled is explicitly turned off (regression)", () => {
    expect(applyAntiraidCascade({ antiraidEnabled: false })).toEqual({
      antiraidEnabled: false,
      antiraidAuto: false,
    });
  });

  it("does not touch antiraidAuto when antiraidEnabled is turned on", () => {
    expect(applyAntiraidCascade({ antiraidEnabled: true })).toEqual({ antiraidEnabled: true });
  });

  it("leaves unrelated patches untouched", () => {
    expect(applyAntiraidCascade({ profanityFilter: false })).toEqual({ profanityFilter: false });
  });

  it("does not clobber an explicit antiraidAuto value already in the same patch", () => {
    // Not a real caller today, but the cascade should never silently override
    // a value the caller itself already set for the same key.
    expect(applyAntiraidCascade({ antiraidEnabled: false, antiraidAuto: false })).toEqual({
      antiraidEnabled: false,
      antiraidAuto: false,
    });
  });
});

describe("applyWarnLimitCascade", () => {
  it("clears warnEscalationEnabled when the limit is explicitly set to 0 (regression)", () => {
    expect(applyWarnLimitCascade({ warnLimit: 0 })).toEqual({
      warnLimit: 0,
      warnEscalationEnabled: false,
    });
  });

  it("does not touch warnEscalationEnabled for a non-zero limit", () => {
    expect(applyWarnLimitCascade({ warnLimit: 5 })).toEqual({ warnLimit: 5 });
  });

  it("leaves unrelated patches untouched", () => {
    expect(applyWarnLimitCascade({ profanityFilter: false })).toEqual({ profanityFilter: false });
  });
});

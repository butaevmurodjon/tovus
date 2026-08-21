import { describe, expect, it } from "vitest";
import { isWithinNightModeWindow } from "./nightMode";

describe("isWithinNightModeWindow", () => {
  it("matches hours inside a same-day window", () => {
    expect(isWithinNightModeWindow(3, 1, 6)).toBe(true);
  });

  it("does not match hours outside a same-day window", () => {
    expect(isWithinNightModeWindow(8, 1, 6)).toBe(false);
    expect(isWithinNightModeWindow(0, 1, 6)).toBe(false);
  });

  it("matches hours on both sides of midnight for a wrapping window", () => {
    expect(isWithinNightModeWindow(23, 23, 7)).toBe(true);
    expect(isWithinNightModeWindow(2, 23, 7)).toBe(true);
  });

  it("does not match daytime hours for a wrapping window", () => {
    expect(isWithinNightModeWindow(12, 23, 7)).toBe(false);
    expect(isWithinNightModeWindow(7, 23, 7)).toBe(false);
  });

  it("includes the start hour and excludes the end hour", () => {
    expect(isWithinNightModeWindow(1, 1, 6)).toBe(true);
    expect(isWithinNightModeWindow(6, 1, 6)).toBe(false);
  });

  it("treats a zero-length window as disabled", () => {
    expect(isWithinNightModeWindow(5, 5, 5)).toBe(false);
    expect(isWithinNightModeWindow(0, 5, 5)).toBe(false);
  });
});

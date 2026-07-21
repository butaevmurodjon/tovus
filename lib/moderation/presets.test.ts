import { describe, expect, it } from "vitest";
import { PRESETS, PRESET_KEYS, isPresetKey } from "./presets";

describe("presets", () => {
  it("has a non-empty word list for every declared key", () => {
    for (const key of PRESET_KEYS) {
      expect(PRESETS[key].length).toBeGreaterThan(0);
    }
  });

  it("has no empty/whitespace-only entries", () => {
    for (const key of PRESET_KEYS) {
      for (const word of PRESETS[key]) {
        expect(word.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("recognizes only the declared keys", () => {
    expect(isPresetKey("agro")).toBe(true);
    expect(isPresetKey("ecommerce")).toBe(true);
    expect(isPresetKey("edtech")).toBe(true);
    expect(isPresetKey("finance")).toBe(true);
    expect(isPresetKey("random")).toBe(false);
  });
});

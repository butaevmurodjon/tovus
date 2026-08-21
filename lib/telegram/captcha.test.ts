import { describe, expect, it } from "vitest";
import { MAX_RULES_TEXT_LENGTH, normalizeRulesText } from "./captcha";

describe("normalizeRulesText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeRulesText("  Правила чата  ")).toBe("Правила чата");
  });

  it("caps length so the sendMessage call can't silently fail (regression)", () => {
    const huge = "a".repeat(10_000);
    expect(normalizeRulesText(huge).length).toBe(MAX_RULES_TEXT_LENGTH);
  });
});

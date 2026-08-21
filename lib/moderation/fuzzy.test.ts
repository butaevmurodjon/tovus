import { describe, expect, it } from "vitest";
import { similarity } from "./fuzzy";

describe("similarity", () => {
  it("returns 1 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1);
  });

  it("returns 1 for two empty strings", () => {
    expect(similarity("", "")).toBe(1);
  });

  it("returns 0 for completely different strings of equal length", () => {
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("scores a single-character typo close to 1", () => {
    expect(similarity("admin", "admln")).toBeCloseTo(0.8, 5);
  });

  it("is symmetric", () => {
    expect(similarity("kitten", "sitting")).toBe(similarity("sitting", "kitten"));
  });
});

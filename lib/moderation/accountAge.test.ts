import { describe, expect, it } from "vitest";
import { estimateAccountCreatedAt, isLikelyNewAccount } from "./accountAge";

describe("estimateAccountCreatedAt", () => {
  it("maps a very low ID to an early date", () => {
    expect(estimateAccountCreatedAt(500).getFullYear()).toBeLessThanOrEqual(2014);
  });

  it("maps a very high ID (beyond the reference table) close to now", () => {
    const estimated = estimateAccountCreatedAt(9_000_000_000);
    const ageDays = (Date.now() - estimated.getTime()) / (24 * 60 * 60 * 1000);
    expect(ageDays).toBeGreaterThanOrEqual(0);
    expect(ageDays).toBeLessThan(365);
  });

  it("never returns a date in the future", () => {
    expect(estimateAccountCreatedAt(50_000_000_000).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("is monotonically non-decreasing in ID", () => {
    const a = estimateAccountCreatedAt(1_000_000_000).getTime();
    const b = estimateAccountCreatedAt(2_000_000_000).getTime();
    const c = estimateAccountCreatedAt(6_000_000_000).getTime();
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });
});

describe("isLikelyNewAccount", () => {
  it("flags an ID mapping to a very recent date as new", () => {
    expect(isLikelyNewAccount(9_000_000_000)).toBe(true);
  });

  it("does not flag a long-established low ID as new", () => {
    expect(isLikelyNewAccount(100_000_000)).toBe(false);
  });
});

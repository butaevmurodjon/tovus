import { describe, it, expect } from "vitest";
import { utcDateBucket } from "./dailySummaryBuffer";

describe("utcDateBucket", () => {
  it("formats a timestamp as YYYY-MM-DD in UTC", () => {
    // 2026-09-14T23:30:00Z stays on the 14th in UTC even though many local
    // timezones would already be on the 15th — that's the point of pinning
    // to UTC rather than server-local time.
    expect(utcDateBucket(Date.parse("2026-09-14T23:30:00Z"))).toBe("2026-09-14");
  });

  it("defaults to the current time when called with no argument", () => {
    expect(utcDateBucket()).toBe(new Date().toISOString().slice(0, 10));
  });
});

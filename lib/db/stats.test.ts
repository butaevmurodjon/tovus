import { describe, expect, it } from "vitest";
import {
  aggregateHourlyBuckets,
  datesBetween,
  pickBestDigestHour,
  pickDigestDayOfMonth,
  sumReasonTagBuckets,
  type HourlyActivityPoint,
} from "./stats";

describe("aggregateHourlyBuckets", () => {
  it("sums the same hour across multiple daily buckets", () => {
    const result = aggregateHourlyBuckets([{ "9": 3 }, { "9": 2 }]);
    expect(result[9]).toEqual({ hour: 9, count: 5 });
  });

  it("returns a fixed 24-length array with zeros for hours never seen", () => {
    const result = aggregateHourlyBuckets([{ "0": 1 }]);
    expect(result).toHaveLength(24);
    expect(result[1]).toEqual({ hour: 1, count: 0 });
    expect(result[23]).toEqual({ hour: 23, count: 0 });
  });

  it("skips null buckets (missing days) without throwing", () => {
    const result = aggregateHourlyBuckets([null, { "5": 4 }, null]);
    expect(result[5]).toEqual({ hour: 5, count: 4 });
  });

  it("ignores out-of-range or malformed hour keys defensively", () => {
    const result = aggregateHourlyBuckets([{ "24": 9, "-1": 9, notanumber: 9, "10": 2 }]);
    expect(result[10]).toEqual({ hour: 10, count: 2 });
    expect(result.reduce((sum, h) => sum + h.count, 0)).toBe(2);
  });

  it("returns all zeros for no buckets", () => {
    const result = aggregateHourlyBuckets([]);
    expect(result.every((h) => h.count === 0)).toBe(true);
    expect(result).toHaveLength(24);
  });
});

describe("datesBetween", () => {
  it("returns one entry per calendar day, inclusive of both ends", () => {
    const result = datesBetween(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-03T23:59:59Z"));
    expect(result).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("returns a single date when start and end fall on the same UTC day", () => {
    const result = datesBetween(new Date("2026-03-05T02:00:00Z"), new Date("2026-03-05T22:00:00Z"));
    expect(result).toEqual(["2026-03-05"]);
  });

  it("crosses a month boundary correctly", () => {
    const result = datesBetween(new Date("2026-01-30T00:00:00Z"), new Date("2026-02-01T00:00:00Z"));
    expect(result).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
  });
});

describe("sumReasonTagBuckets", () => {
  it("sums a tag across multiple daily buckets and zero-fills every tag", () => {
    const totals = sumReasonTagBuckets([{ ads: 2 }, { ads: 3, scam: 1 }]);
    expect(totals.ads).toBe(5);
    expect(totals.scam).toBe(1);
    expect(totals.profanity).toBe(0);
    expect(totals.other).toBe(0);
  });

  it("skips null buckets (missing days) without throwing", () => {
    const totals = sumReasonTagBuckets([null, { apk: 1 }, null]);
    expect(totals.apk).toBe(1);
  });

  it("returns every tag at zero for no buckets", () => {
    const totals = sumReasonTagBuckets([]);
    expect(Object.values(totals).every((n) => n === 0)).toBe(true);
  });
});

describe("pickBestDigestHour", () => {
  it("picks the hour with the highest count", () => {
    const points: HourlyActivityPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 19 ? 42 : 1 }));
    expect(pickBestDigestHour(points)).toBe(19);
  });

  it("falls back to noon UTC (12) for an empty input", () => {
    expect(pickBestDigestHour([])).toBe(12);
  });

  it("falls back to noon UTC (12) for an all-zero input", () => {
    const points: HourlyActivityPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    expect(pickBestDigestHour(points)).toBe(12);
  });

  it("on a tie, picks the lower/earlier hour deterministically", () => {
    const points: HourlyActivityPoint[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 3 || hour === 15 ? 10 : 1,
    }));
    expect(pickBestDigestHour(points)).toBe(3);
  });
});

describe("pickDigestDayOfMonth", () => {
  it("always returns a value in [1, 28]", () => {
    const chatIds = [1, 42, -1001234567890, -100987654321, 0, 999999999, -1];
    for (const chatId of chatIds) {
      const day = pickDigestDayOfMonth(chatId);
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(28);
    }
  });

  it("is deterministic for the same chatId", () => {
    expect(pickDigestDayOfMonth(-1001234567890)).toBe(pickDigestDayOfMonth(-1001234567890));
  });

  it("handles negative supergroup chat ids without going out of range (regression)", () => {
    // Real Telegram supergroup ids are negative; an unguarded `chatId % 28`
    // would return a non-positive number here without Math.abs.
    const day = pickDigestDayOfMonth(-1001234567890);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(28);
  });
});

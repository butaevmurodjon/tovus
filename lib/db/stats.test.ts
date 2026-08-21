import { describe, expect, it } from "vitest";
import { aggregateHourlyBuckets } from "./stats";

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

import { describe, expect, it } from "vitest";
import {
  aggregateShadowBuckets,
  classifyDivergence,
  estimateLatencyPercentile,
  latencyField,
  type ShadowStatsBucket,
} from "./shadowStats";

describe("classifyDivergence", () => {
  it("is null when the old verdict isn't comparable", () => {
    expect(classifyDivergence(false, "spam", "escalate")).toBeNull();
    expect(classifyDivergence(false, null, "ok")).toBeNull();
  });

  it("agrees when both sides say clean", () => {
    expect(classifyDivergence(true, null, "ok")).toBe("agree");
  });

  it("agrees when both sides flag it, regardless of new zone level", () => {
    expect(classifyDivergence(true, "spam", "warn")).toBe("agree");
    expect(classifyDivergence(true, "spam", "escalate")).toBe("agree");
  });

  it("is stricter when the new scorer flags something the old pipeline let through", () => {
    expect(classifyDivergence(true, null, "warn")).toBe("stricter");
    expect(classifyDivergence(true, null, "escalate")).toBe("stricter");
  });

  it("is looser when the old pipeline flagged something the new scorer calls ok", () => {
    expect(classifyDivergence(true, "spam", "ok")).toBe("looser");
  });
});

describe("latencyField", () => {
  it("buckets by upper bound, open-ended past the last bound", () => {
    expect(latencyField(0)).toBe("lat_lt10");
    expect(latencyField(9.9)).toBe("lat_lt10");
    expect(latencyField(10)).toBe("lat_lt25");
    expect(latencyField(249)).toBe("lat_lt250");
    expect(latencyField(250)).toBe("lat_ge250");
    expect(latencyField(10_000)).toBe("lat_ge250");
  });
});

describe("aggregateShadowBuckets", () => {
  it("sums plain counters across days and skips missing (null) days", () => {
    const result = aggregateShadowBuckets([
      { total: 10, comparable: 8, zone_ok: 6, zone_warn: 3, zone_escalate: 1, reputation_only_trigger: 2 },
      null,
      { total: 5, comparable: 5, zone_ok: 5, zone_warn: 0, zone_escalate: 0, reputation_only_trigger: 0 },
    ]);
    expect(result.total).toBe(15);
    expect(result.comparable).toBe(13);
    expect(result.zone).toEqual({ ok: 11, warn: 3, escalate: 1 });
    expect(result.reputationOnlyTrigger).toBe(2);
  });

  it("derives agree from cmp_ok_noflag plus cmp_{warn,escalate}_flag", () => {
    const result = aggregateShadowBuckets([
      { total: 3, cmp_ok_noflag: 1, cmp_warn_flag: 1, cmp_escalate_flag: 1 },
    ]);
    expect(result.divergence).toEqual({ agree: 3, stricter: 0, looser: 0 });
  });

  it("derives stricter from cmp_{warn,escalate}_noflag", () => {
    const result = aggregateShadowBuckets([{ total: 2, cmp_warn_noflag: 1, cmp_escalate_noflag: 1 }]);
    expect(result.divergence).toEqual({ agree: 0, stricter: 2, looser: 0 });
  });

  it("derives looser from cmp_ok_flag", () => {
    const result = aggregateShadowBuckets([{ total: 1, cmp_ok_flag: 1 }]);
    expect(result.divergence).toEqual({ agree: 0, stricter: 0, looser: 1 });
  });

  it("a rep-floor spike (empty signals, zone warn) reads as reputation_only_trigger, not a content divergence signal on its own", () => {
    // The counter exists precisely so this case is visible separately from
    // "stricter" — this test just pins that the aggregator reports both,
    // leaving the reader to cross-reference rather than conflating them.
    const result = aggregateShadowBuckets([{ total: 1, cmp_warn_noflag: 1, reputation_only_trigger: 1 }]);
    expect(result.divergence.stricter).toBe(1);
    expect(result.reputationOnlyTrigger).toBe(1);
  });

  it("returns all-zero buckets for an empty list", () => {
    const result = aggregateShadowBuckets([]);
    expect(result.total).toBe(0);
    expect(result.divergence).toEqual({ agree: 0, stricter: 0, looser: 0 });
  });
});

describe("estimateLatencyPercentile", () => {
  const buckets: ShadowStatsBucket["latencyBuckets"] = {
    lat_lt10: 50,
    lat_lt25: 30,
    lat_lt50: 15,
    lat_lt100: 4,
    lat_lt250: 1,
    lat_ge250: 0,
  };

  it("returns the upper bound of the bucket where the cumulative count crosses p", () => {
    // p50 target = 50 -> cumulative reaches 50 exactly at lat_lt10.
    expect(estimateLatencyPercentile(buckets, 0.5)).toBe(10);
    // p95 target = 95 -> cumulative: 50, 80, 95 at lat_lt50.
    expect(estimateLatencyPercentile(buckets, 0.95)).toBe(50);
  });

  it("returns null when the total is zero", () => {
    const empty: ShadowStatsBucket["latencyBuckets"] = {
      lat_lt10: 0,
      lat_lt25: 0,
      lat_lt50: 0,
      lat_lt100: 0,
      lat_lt250: 0,
      lat_ge250: 0,
    };
    expect(estimateLatencyPercentile(empty, 0.5)).toBeNull();
  });

  it("returns null when the target percentile only lands in the open-ended ge250 bucket", () => {
    const allSlow: ShadowStatsBucket["latencyBuckets"] = {
      lat_lt10: 0,
      lat_lt25: 0,
      lat_lt50: 0,
      lat_lt100: 0,
      lat_lt250: 0,
      lat_ge250: 10,
    };
    expect(estimateLatencyPercentile(allSlow, 0.5)).toBeNull();
  });
});

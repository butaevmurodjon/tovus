import { describe, expect, it } from "vitest";
import { aggregateReactionBuckets } from "./reactionStats";

describe("aggregateReactionBuckets", () => {
  it("returns nulls for a path with no samples", () => {
    const { base, ai } = aggregateReactionBuckets([]);
    expect(base).toEqual({
      count: 0,
      meanProcMs: null,
      p50ProcMs: null,
      p95ProcMs: null,
      meanVisibleMs: null,
    });
    expect(ai.count).toBe(0);
  });

  it("averages proc and visible times across daily buckets, per path", () => {
    const { base } = aggregateReactionBuckets([
      { base_n: 2, base_proc_sum: 600, base_vis_n: 2, base_vis_sum: 1400, base_proc_lt400: 2 },
      { base_n: 2, base_proc_sum: 400, base_vis_n: 1, base_vis_sum: 500, base_proc_lt400: 2 },
    ]);
    expect(base.count).toBe(4);
    expect(base.meanProcMs).toBe(250); // 1000 / 4
    expect(base.meanVisibleMs).toBe(633); // round(1900 / 3)
  });

  it("keeps base and ai paths independent", () => {
    const { base, ai } = aggregateReactionBuckets([
      { base_n: 1, base_proc_sum: 300, base_proc_lt400: 1, ai_n: 1, ai_proc_sum: 1800, ai_proc_ge2500: 0, ai_proc_lt2500: 1 },
    ]);
    expect(base.meanProcMs).toBe(300);
    expect(ai.meanProcMs).toBe(1800);
  });

  it("estimates p50/p95 from the proc histogram; open-ended bucket reports null", () => {
    // 10 samples: 8 under 200ms, 2 in the open-ended (>=5000ms) bucket
    const { base } = aggregateReactionBuckets([
      { base_n: 10, base_proc_sum: 6000, base_proc_lt200: 8, base_proc_ge5000: 2 },
    ]);
    expect(base.p50ProcMs).toBe(200); // median falls in the first bucket
    expect(base.p95ProcMs).toBeNull(); // 95th percentile is in the open-ended bucket
  });

  it("skips null buckets without throwing", () => {
    const { base } = aggregateReactionBuckets([null, { base_n: 1, base_proc_sum: 100, base_proc_lt200: 1 }, null]);
    expect(base.count).toBe(1);
    expect(base.meanProcMs).toBe(100);
  });
});

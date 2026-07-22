import { describe, expect, it } from "vitest";
import { computeFederationCandidates } from "./federation";

describe("computeFederationCandidates", () => {
  it("excludes the source chat itself even if it appears in an admin's group list", () => {
    const candidates = computeFederationCandidates(1, [[1, 2, 3]]);
    expect(candidates.sort()).toEqual([2, 3]);
  });

  it("unions groups across multiple shared admins without duplicates", () => {
    const candidates = computeFederationCandidates(1, [
      [1, 2, 3],
      [1, 3, 4],
    ]);
    expect(candidates.sort()).toEqual([2, 3, 4]);
  });

  it("returns nothing when the source group has no admins on record", () => {
    expect(computeFederationCandidates(1, [])).toEqual([]);
  });

  it("returns nothing when the only admin administers no other group", () => {
    expect(computeFederationCandidates(1, [[1]])).toEqual([]);
  });
});

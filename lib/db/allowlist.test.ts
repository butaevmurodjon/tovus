import { describe, expect, it, vi } from "vitest";

// Same Upstash quirk as customWords.test.ts — a numeric-looking allowlist
// entry comes back from smembers() as a JS `number`, not a string.
const smembers = vi.fn(async () => ["example.com", 12345, "не спам"]);
vi.mock("./redis", () => ({
  getRedis: () => ({ smembers }),
}));

const { getAllowlist } = await import("./allowlist");

describe("getAllowlist", () => {
  it("coerces every entry to a string, even one Upstash returns as a number", async () => {
    const entries = await getAllowlist(-1001260281192);
    for (const e of entries) {
      expect(typeof e).toBe("string");
    }
    expect(entries).toContain("12345");
  });
});

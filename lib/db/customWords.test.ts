import { describe, expect, it, vi } from "vitest";

// Real incident (2026-09-14): Upstash's REST client auto-deserializes a set
// member that looks like a JSON number ("950316066", added as a custom word —
// someone's phone number/ID they wanted filtered) back into a JS `number`,
// even though getCustomWords is typed `string[]`. That crashed EVERY message
// in a chat with profanityFilter on: buildCustomWordsRegex's
// `.map((w) => w.trim()...)` threw "w.trim is not a function", 500ing the
// webhook for the whole chat with no visible error to the group. See
// lib/db/customWords.ts's getCustomWords comment.
const smembers = vi.fn(async () => ["помогу с деньгами", 950316066, "впн"]);
vi.mock("./redis", () => ({
  getRedis: () => ({ smembers }),
}));

const { getCustomWords } = await import("./customWords");

describe("getCustomWords", () => {
  it("coerces every member to a string, even one Upstash returns as a number", async () => {
    const words = await getCustomWords(-1001260281192);
    for (const w of words) {
      expect(typeof w).toBe("string");
    }
    expect(words).toContain("950316066");
  });
});

import { describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};
const hset = vi.fn(async (_key: string, fields: Record<string, unknown>) => {
  Object.assign(store, fields);
});
const hgetall = vi.fn(async () => ({ ...store }));
const hdel = vi.fn(async (_key: string, field: string) => {
  delete store[field];
});
vi.mock("./redis", () => ({
  getRedis: () => ({ hset, hgetall, hdel }),
}));

const { addUsernameStemBan, isValidStem, matchesUsernameStemBan } = await import("./usernameStemBans");

describe("usernameStemBans", () => {
  it("rejects a stem shorter than the minimum length", () => {
    expect(isValidStem("abc")).toBe(false);
    expect(isValidStem("@abc")).toBe(false);
    expect(isValidStem("abcd")).toBe(true);
  });

  it("normalizes a leading @ and case before storing", async () => {
    const entry = await addUsernameStemBan({
      stem: "@Mariya_Sharapova_",
      reason: "spam family",
      bannedAt: Date.now(),
      bannedBy: 1,
    });
    expect(entry.stem).toBe("mariya_sharapova_");
  });

  it("matches a future account whose username shares only the fixed prefix", async () => {
    const hit = await matchesUsernameStemBan("mariya_sharapova_x3q1");
    expect(hit?.stem).toBe("mariya_sharapova_");
  });

  it("matches case-insensitively", async () => {
    const hit = await matchesUsernameStemBan("MARIYA_SHARAPOVA_ZZZZ");
    expect(hit?.stem).toBe("mariya_sharapova_");
  });

  it("does not match an unrelated username, and tolerates a null one", async () => {
    expect(await matchesUsernameStemBan("someone_else")).toBeNull();
    expect(await matchesUsernameStemBan(null)).toBeNull();
    expect(await matchesUsernameStemBan(undefined)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./fakeRedis";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { incrWithTtl } = await import("./redis");

describe("incrWithTtl (TZ.md §9.1, G5)", () => {
  it("increments and sets a TTL on the first call, in one round trip", async () => {
    const count = await incrWithTtl("k1", 60);
    expect(count).toBe(1);
    expect(fake.ttlOf("k1")).toBe(60);
    expect(fake.evalCallCount).toBe(1);
  });

  it("does not reset the TTL on later increments", async () => {
    await incrWithTtl("k2", 60);
    await incrWithTtl("k2", 30);
    // Second call passed a different ttlSeconds on purpose — if the TTL were
    // reset on every increment (the bug this replaces couldn't even reach
    // this case, since it never re-set the TTL at all) it would show 30 here.
    expect(fake.ttlOf("k2")).toBe(60);
  });

  it("under concurrent calls, the key ends up with exactly one TTL set (the atomicity G5 exists for)", async () => {
    const results = await Promise.all([incrWithTtl("k3", 60), incrWithTtl("k3", 60), incrWithTtl("k3", 60)]);
    expect(results.sort()).toEqual([1, 2, 3]);
    expect(fake.ttlOf("k3")).toBe(60);
  });

  it("repairs a key that leaked under the old two-call code (nonzero count, no TTL)", async () => {
    fake.seedWithoutTtl("k4", 5);
    expect(fake.ttlOf("k4")).toBeUndefined();
    const count = await incrWithTtl("k4", 60);
    expect(count).toBe(6);
    expect(fake.ttlOf("k4")).toBe(60);
  });
});

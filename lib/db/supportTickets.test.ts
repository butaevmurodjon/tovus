import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./fakeRedis";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

// Only the cooldown functions are covered here — same boundary as
// appeals.test.ts, whose addAppeal/listAppeals (hash + sorted-set ops) also
// go untested because FakeRedis doesn't model hset/zadd/hget/zrange. The
// hash+sorted-set storage in this file (addSupportTicket etc.) follows the
// same well-established pattern as appeals.ts/journal.ts and is exercised in
// practice through those; adding a hash/zset-capable fake is out of scope
// for this feature.
const { isSupportOnCooldown, tryStartSupportCooldown } = await import("./supportTickets");

describe("tryStartSupportCooldown", () => {
  it("returns true the first time and claims the cooldown", async () => {
    expect(await tryStartSupportCooldown(101)).toBe(true);
    expect(await isSupportOnCooldown(101)).toBe(true);
  });

  it("returns false on a second call for the same user while the cooldown is active", async () => {
    await tryStartSupportCooldown(102);
    expect(await tryStartSupportCooldown(102)).toBe(false);
  });

  it("under two concurrent claims, exactly one wins", async () => {
    const [a, b] = await Promise.all([tryStartSupportCooldown(103), tryStartSupportCooldown(103)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("is scoped per user — a different user is unaffected", async () => {
    await tryStartSupportCooldown(104);
    expect(await tryStartSupportCooldown(105)).toBe(true);
  });
});

describe("isSupportOnCooldown", () => {
  it("is false for a user who never claimed one", async () => {
    expect(await isSupportOnCooldown(999)).toBe(false);
  });
});

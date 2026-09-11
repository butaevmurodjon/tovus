import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "./fakeRedis";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { tryStartAppealCooldown } = await import("./appeals");

describe("tryStartAppealCooldown", () => {
  it("returns true the first time and claims the cooldown", async () => {
    expect(await tryStartAppealCooldown(-1, 1)).toBe(true);
  });

  it("returns false on a second call for the same (chat, user) while the cooldown is active", async () => {
    await tryStartAppealCooldown(-1, 2);
    expect(await tryStartAppealCooldown(-1, 2)).toBe(false);
  });

  it("under two concurrent claims, exactly one wins (regression: used to be a separate exists-then-set)", async () => {
    const [a, b] = await Promise.all([tryStartAppealCooldown(-1, 3), tryStartAppealCooldown(-1, 3)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("is scoped per (chat, user) — a different chat or user is unaffected", async () => {
    await tryStartAppealCooldown(-1, 4);
    expect(await tryStartAppealCooldown(-2, 4)).toBe(true);
    expect(await tryStartAppealCooldown(-1, 5)).toBe(true);
  });
});

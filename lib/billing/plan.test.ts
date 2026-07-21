import { describe, expect, it } from "vitest";
import { FREE_TIER_MAX_MEMBERS, canUseProFeature, isProActive, requiresProForSize } from "./plan";

describe("isProActive", () => {
  it("is false for a free plan", () => {
    expect(isProActive({ plan: "free", planExpiresAt: null })).toBe(false);
  });

  it("is false for a pro plan with no expiry recorded", () => {
    expect(isProActive({ plan: "pro", planExpiresAt: null })).toBe(false);
  });

  it("is false once the subscription has expired", () => {
    expect(isProActive({ plan: "pro", planExpiresAt: Date.now() - 1000 })).toBe(false);
  });

  it("is true while the subscription is still active", () => {
    expect(isProActive({ plan: "pro", planExpiresAt: Date.now() + 1000 * 60 * 60 })).toBe(true);
  });
});

describe("requiresProForSize", () => {
  it("does not require pro when member count is unknown", () => {
    expect(requiresProForSize(null)).toBe(false);
  });

  it("does not require pro at or under the free threshold", () => {
    expect(requiresProForSize(FREE_TIER_MAX_MEMBERS)).toBe(false);
    expect(requiresProForSize(1)).toBe(false);
  });

  it("requires pro above the free threshold", () => {
    expect(requiresProForSize(FREE_TIER_MAX_MEMBERS + 1)).toBe(true);
  });
});

describe("canUseProFeature", () => {
  const freeSettings = { plan: "free" as const, planExpiresAt: null };
  const activeProSettings = { plan: "pro" as const, planExpiresAt: Date.now() + 100_000 };

  it("allows a small free group", () => {
    expect(canUseProFeature(freeSettings, 50)).toBe(true);
  });

  it("blocks a large free group", () => {
    expect(canUseProFeature(freeSettings, FREE_TIER_MAX_MEMBERS + 1)).toBe(false);
  });

  it("allows a large group with an active subscription", () => {
    expect(canUseProFeature(activeProSettings, 10_000)).toBe(true);
  });

  it("blocks a large group whose subscription lapsed", () => {
    const lapsed = { plan: "pro" as const, planExpiresAt: Date.now() - 1000 };
    expect(canUseProFeature(lapsed, FREE_TIER_MAX_MEMBERS + 1)).toBe(false);
  });
});

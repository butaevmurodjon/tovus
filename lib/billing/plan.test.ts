import { describe, expect, it } from "vitest";
import {
  FREE_TIER_MAX_MEMBERS,
  canUseProFeature,
  formatPlanDate,
  formatPlanLabel,
  isProActive,
  requiresProForSize,
} from "./plan";

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
  it("fails closed when member count is unknown (regression) — unknown must never mean unlimited free Pro", () => {
    expect(requiresProForSize(null)).toBe(true);
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

  it("blocks a free group when member count is unknown (regression) — must not fail open", () => {
    expect(canUseProFeature(freeSettings, null)).toBe(false);
  });

  it("still allows an active Pro subscription even when member count is unknown", () => {
    expect(canUseProFeature(activeProSettings, null)).toBe(true);
  });
});

describe("formatPlanDate", () => {
  it("renders a dash for no expiry", () => {
    expect(formatPlanDate(null, "ru")).toBe("—");
    expect(formatPlanDate(undefined, "ru")).toBe("—");
  });

  it("formats a real date", () => {
    const ms = new Date("2026-08-10T00:00:00Z").getTime();
    expect(formatPlanDate(ms, "ru")).toMatch(/2026/);
  });
});

describe("formatPlanLabel", () => {
  it("returns the free label for a free plan", () => {
    expect(formatPlanLabel({ plan: "free", planExpiresAt: null }, "ru")).toContain("Базовый");
  });

  it("returns a pro label with the expiry date for an active subscription", () => {
    const ms = new Date("2026-08-10T00:00:00Z").getTime();
    const label = formatPlanLabel({ plan: "pro", planExpiresAt: ms }, "ru");
    expect(label).toContain("PRO");
    expect(label).toMatch(/2026/);
  });
});

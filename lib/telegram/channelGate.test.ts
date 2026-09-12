import { describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { FakeRedis } from "@/lib/db/fakeRedis";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/lib/db/types";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { activeGateSources, checkChannelGate, shouldShowGatePrompt } = await import("./channelGate");

function settingsWith(patch: Partial<GroupSettings>): GroupSettings {
  return { ...DEFAULT_GROUP_SETTINGS, chatId: -1, title: "t", lang: "ru", createdAt: 0, ...patch };
}

function fakeApi(statusByUser: Record<number, string>): Api {
  return {
    getChatMember: async (_chatId: number, userId: number) => {
      const status = statusByUser[userId];
      if (!status) {
        throw new GrammyError("Bad Request", { ok: false, error_code: 400, description: "not found" }, "getChatMember", {});
      }
      return { status } as never;
    },
    getChat: async () => ({ id: -100, type: "channel", username: "tovus_antispam" }) as never,
  } as unknown as Api;
}

describe("activeGateSources", () => {
  it("returns nothing when both sources are off", () => {
    expect(activeGateSources(settingsWith({}))).toEqual([]);
  });

  it("includes the owner source only when enabled AND a channel id is stored", () => {
    expect(activeGateSources(settingsWith({ ownerChannelGateEnabled: true, ownerChannelId: null }))).toEqual([]);
    const sources = activeGateSources(
      settingsWith({ ownerChannelGateEnabled: true, ownerChannelId: -100, ownerChannelUsername: "owner" })
    );
    expect(sources).toEqual([{ kind: "owner", channelId: -100, username: "owner" }]);
  });

  it("includes the promo source only when promoChannelOptIn is explicitly on (opt-in, never implied)", () => {
    expect(activeGateSources(settingsWith({ promoChannelOptIn: false }))).toEqual([]);
    const sources = activeGateSources(settingsWith({ promoChannelOptIn: true }));
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe("promo");
  });

  it("returns both, owner first, when both are on", () => {
    const sources = activeGateSources(
      settingsWith({
        ownerChannelGateEnabled: true,
        ownerChannelId: -100,
        ownerChannelUsername: "owner",
        promoChannelOptIn: true,
      })
    );
    expect(sources.map((s) => s.kind)).toEqual(["owner", "promo"]);
  });
});

describe("checkChannelGate", () => {
  it("passes trivially when no source is active", async () => {
    const api = fakeApi({});
    const result = await checkChannelGate(api, settingsWith({}), 1);
    expect(result).toEqual({ passed: true, unmet: [] });
  });

  it("fails when the user is not subscribed to the owner channel", async () => {
    const api = fakeApi({ 1: "left" });
    const settings = settingsWith({ ownerChannelGateEnabled: true, ownerChannelId: -100, ownerChannelUsername: "owner" });
    const result = await checkChannelGate(api, settings, 1);
    expect(result.passed).toBe(false);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].kind).toBe("owner");
  });

  it("passes when the user IS subscribed", async () => {
    // Distinct (channelId, userId) from the previous test — isChannelMember
    // caches its result in Redis, and this suite shares one FakeRedis
    // instance across tests, so reusing the same pair here would just read
    // back the earlier "left" cache entry instead of exercising this case.
    const api = fakeApi({ 2: "member" });
    const settings = settingsWith({ ownerChannelGateEnabled: true, ownerChannelId: -101, ownerChannelUsername: "owner" });
    const result = await checkChannelGate(api, settings, 2);
    expect(result).toEqual({ passed: true, unmet: [] });
  });

  it("fails open (treated as passed) when the bot can't verify membership (not admin there)", async () => {
    const api = fakeApi({}); // getChatMember throws GrammyError for any user
    const settings = settingsWith({ ownerChannelGateEnabled: true, ownerChannelId: -999, ownerChannelUsername: "owner" });
    const result = await checkChannelGate(api, settings, 42);
    expect(result).toEqual({ passed: true, unmet: [] });
  });

  it("requires BOTH sources when both are enabled", async () => {
    const api = fakeApi({ 1: "left" }); // not subscribed to the owner channel; promo channel resolve+lookup below
    const settings = settingsWith({
      ownerChannelGateEnabled: true,
      ownerChannelId: -100,
      ownerChannelUsername: "owner",
      promoChannelOptIn: true,
    });
    const result = await checkChannelGate(api, settings, 1);
    expect(result.passed).toBe(false);
    expect(result.unmet.map((s) => s.kind)).toContain("owner");
  });
});

describe("shouldShowGatePrompt", () => {
  it("returns true the first time and false again within the cooldown window", async () => {
    expect(await shouldShowGatePrompt(-5, 1)).toBe(true);
    expect(await shouldShowGatePrompt(-5, 1)).toBe(false);
  });

  it("is scoped per (chat, user) — a different user in the same chat gets their own prompt", async () => {
    expect(await shouldShowGatePrompt(-6, 10)).toBe(true);
    expect(await shouldShowGatePrompt(-6, 11)).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "grammy/types";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/lib/db/types";
import { collectSpamSignals, isReputationOnlyTrigger, moderationV2Mode, runShadowScoring, scoreSignals } from "./scoring";

// runShadowScoring's gating tests below exercise real code past the Redis
// boundary — stub the two Redis-touching calls so the tests assert on
// gating logic, not on network behavior (no live Upstash creds in CI/local).
vi.mock("./reputation", () => ({ getReputationScore: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/db/shadowStats", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/shadowStats")>();
  return { ...actual, recordShadowScoring: vi.fn().mockResolvedValue(undefined) };
});

function msg(overrides: Partial<Message> = {}): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: -1, type: "supergroup" } as Message["chat"],
    from: { id: 42, is_bot: false, first_name: "x" } as Message["from"],
    ...overrides,
  } as Message;
}

function groupSettings(overrides: Partial<GroupSettings> = {}): GroupSettings {
  return {
    chatId: -1,
    title: "test",
    createdAt: 0,
    lang: "ru",
    ...DEFAULT_GROUP_SETTINGS,
    ...overrides,
  };
}

describe("moderationV2Mode", () => {
  it("defaults to off when unset", () => {
    delete process.env.MODERATION_V2;
    expect(moderationV2Mode()).toBe("off");
  });

  it("accepts shadow and on", () => {
    process.env.MODERATION_V2 = "shadow";
    expect(moderationV2Mode()).toBe("shadow");
    process.env.MODERATION_V2 = "on";
    expect(moderationV2Mode()).toBe("on");
    delete process.env.MODERATION_V2;
  });

  it("degrades an unrecognized value to off instead of throwing", () => {
    process.env.MODERATION_V2 = "yolo";
    expect(moderationV2Mode()).toBe("off");
    delete process.env.MODERATION_V2;
  });
});

describe("collectSpamSignals", () => {
  it("returns nothing for an ordinary message", () => {
    expect(collectSpamSignals(msg({ text: "как дела, что нового?" }))).toEqual([]);
  });

  it("flags a dangerous file regardless of caption", () => {
    const signals = collectSpamSignals(
      msg({ document: { file_name: "bank-update.apk", file_id: "x", file_unique_id: "x" } as never })
    );
    expect(signals).toEqual([{ name: "dangerous_file", weight: 100, evidence: ".apk", group: "link-risk" }]);
  });

  it("flags a blacklisted domain once even with repeats (plus link-count, both link-risk group)", () => {
    const signals = collectSpamSignals(msg({ text: "переходи https://bit.ly/x и https://bit.ly/y" }));
    expect(signals.filter((s) => s.name === "blacklisted_domain")).toEqual([
      { name: "blacklisted_domain", weight: 85, evidence: "bit.ly", group: "link-risk" },
    ]);
    // Both signals are collected as evidence — scoreSignals takes the max of
    // the link-risk group (85), not the sum, so this doesn't double-count.
    expect(scoreSignals(signals, 0).score).toBe(85);
  });

  it("flags mass mentions as a standalone additive signal", () => {
    const signals = collectSpamSignals(
      msg({
        text: "@a @b @c @d привет",
        entities: [
          { type: "mention", offset: 0, length: 2 },
          { type: "mention", offset: 3, length: 2 },
          { type: "mention", offset: 6, length: 2 },
          { type: "mention", offset: 9, length: 2 },
        ] as never,
      })
    );
    expect(signals).toEqual([{ name: "mass_mentions", weight: 45, evidence: "4 mentions" }]);
  });

  it("collects a CTA phrase alone as new evidence (weight 20, unlike spam.ts which required a link/forward/mention)", () => {
    const signals = collectSpamSignals(msg({ text: "хочешь заработать без вложений" }));
    expect(signals).toEqual([{ name: "cta_alone", weight: 20, evidence: "cta" }]);
  });

  it("does not double-count a CTA phrase already counted inside link_cta (regression, §4.11)", () => {
    const signals = collectSpamSignals(msg({ text: "переходи по ссылке https://example.com/x" }));
    expect(signals).toEqual([{ name: "link_cta", weight: 65, evidence: "link+cta", group: "link-risk" }]);
    expect(signals.some((s) => s.name === "cta_alone")).toBe(false);
    expect(scoreSignals(signals, 0).score).toBe(65);
  });

  it("does not double-count a CTA phrase already counted inside forward_cta (regression, §4.11)", () => {
    const signals = collectSpamSignals(
      msg({ text: "жми сюда", forward_origin: { type: "hidden_user", date: 0, sender_user_name: "x" } as never })
    );
    expect(signals).toEqual([{ name: "forward_cta", weight: 70, evidence: "forward+cta", group: "link-risk" }]);
    expect(signals.some((s) => s.name === "cta_alone")).toBe(false);
  });

  it("collects both a link-risk signal and an independent additive signal for the same message", () => {
    const signals = collectSpamSignals(
      msg({
        text: "@a @b @c @d bit.ly/x",
        entities: [
          { type: "mention", offset: 0, length: 2 },
          { type: "mention", offset: 3, length: 2 },
          { type: "mention", offset: 6, length: 2 },
          { type: "mention", offset: 9, length: 2 },
          { type: "url", offset: 12, length: 8 },
        ] as never,
      })
    );
    expect(signals).toContainEqual({ name: "blacklisted_domain", weight: 85, evidence: "bit.ly", group: "link-risk" });
    expect(signals).toContainEqual({ name: "mass_mentions", weight: 45, evidence: "4 mentions" });
  });
});

describe("scoreSignals", () => {
  it("sums additive signals and maps to the ok zone below 21", () => {
    const result = scoreSignals([{ name: "cta_alone", weight: 20, evidence: "cta" }], 0);
    expect(result).toEqual({ score: 20, zone: "ok", signals: expect.any(Array) });
  });

  it("only counts the max of the link-risk group, not the sum of all matches", () => {
    const signals = [
      { name: "blacklisted_domain", weight: 85, evidence: "x", group: "link-risk" as const },
      { name: "link_count_low", weight: 30, evidence: "2 links", group: "link-risk" as const },
    ];
    const result = scoreSignals(signals, 0);
    expect(result.score).toBe(85);
    expect(result.zone).toBe("escalate");
  });

  it("adds a +20 modifier once reputation score reaches 30", () => {
    const result = scoreSignals([{ name: "cta_alone", weight: 20, evidence: "cta" }], 30);
    expect(result.score).toBe(40);
    expect(result.zone).toBe("warn");
  });

  it("forces at least the warn zone once reputation score reaches 60, even with weak content signals", () => {
    const result = scoreSignals([], 60);
    expect(result.score).toBe(21);
    expect(result.zone).toBe("warn");
  });

  it("never lets the reputation modifier push a message below its own content score", () => {
    const result = scoreSignals([{ name: "dangerous_file", weight: 100, evidence: ".exe", group: "link-risk" }], 60);
    expect(result.score).toBe(100);
  });

  it("clamps the total to 100", () => {
    const signals = [
      { name: "dangerous_file", weight: 100, evidence: ".exe", group: "link-risk" as const },
      { name: "mass_mentions", weight: 45, evidence: "5 mentions" },
    ];
    const result = scoreSignals(signals, 30);
    expect(result.score).toBe(100);
  });

  it("zones: ok <=20, warn 21..59, escalate >=60", () => {
    expect(scoreSignals([{ name: "cta_alone", weight: 20, evidence: "cta" }], 0).zone).toBe("ok");
    expect(scoreSignals([{ name: "mass_mentions", weight: 45, evidence: "x" }], 0).zone).toBe("warn");
    expect(scoreSignals([{ name: "dangerous_file", weight: 100, evidence: "x", group: "link-risk" }], 0).zone).toBe(
      "escalate"
    );
  });
});

describe("isReputationOnlyTrigger", () => {
  it("is true when reputation alone pushed an empty-signal message out of the ok zone", () => {
    const result = scoreSignals([], 60);
    expect(isReputationOnlyTrigger([], result.zone)).toBe(true);
  });

  it("is false when content signals are present, even alongside the reputation modifier", () => {
    const signals = [{ name: "cta_alone", weight: 20, evidence: "cta" } as const];
    const result = scoreSignals(signals, 60);
    expect(isReputationOnlyTrigger(signals, result.zone)).toBe(false);
  });

  it("is false for an empty signal list that stays in the ok zone", () => {
    expect(isReputationOnlyTrigger([], "ok")).toBe(false);
  });
});

describe("runShadowScoring gating (regression: found in review)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MODERATION_V2 = "shadow";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.MODERATION_V2;
    logSpy.mockRestore();
  });

  it("skips edits entirely — an edit must not re-score or re-log the same message", async () => {
    await runShadowScoring(msg(), groupSettings(), null, { isEdit: true });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("skips a chat where both antispam and restrictNewMembersEnabled are off", async () => {
    await runShadowScoring(msg(), groupSettings({ antispam: false, restrictNewMembersEnabled: false }), null);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("still scores when antispam is off but restrictNewMembersEnabled is on (real pipeline still moderates via restricted-content)", async () => {
    await runShadowScoring(msg(), groupSettings({ antispam: false, restrictNewMembersEnabled: true }), null);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("still scores a plain antispam-only chat (unchanged behavior)", async () => {
    await runShadowScoring(msg(), groupSettings({ antispam: true, restrictNewMembersEnabled: false }), null);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

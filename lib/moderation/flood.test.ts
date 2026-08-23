import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/db/fakeRedis";
import { DUPLICATE_MAX_COUNT, FLOOD_MAX_MESSAGES, RAID_JOIN_THRESHOLD } from "./spamDict";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const {
  checkDuplicateFlood,
  checkRaid,
  checkUserFlood,
  consumeNewMemberFlag,
  isWithinNewMemberWindow,
  markNewMember,
  peekDuplicateFloodCount,
  peekUserFloodCount,
} = await import("./flood");

describe("consumeNewMemberFlag (TZ.md §9.1, G2)", () => {
  it("returns false when the member was never marked", async () => {
    expect(await consumeNewMemberFlag(-1, 999)).toBe(false);
  });

  it("returns true once and consumes the flag — a second read gets nothing", async () => {
    await markNewMember(-1, 1);
    expect(await consumeNewMemberFlag(-1, 1)).toBe(true);
    expect(await consumeNewMemberFlag(-1, 1)).toBe(false);
  });

  it("under two concurrent reads, exactly one gets the leniency (regression: used to be GET-then-DEL)", async () => {
    await markNewMember(-1, 2);
    const [a, b] = await Promise.all([consumeNewMemberFlag(-1, 2), consumeNewMemberFlag(-1, 2)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("checkUserFlood / checkDuplicateFlood / checkRaid", () => {
  it("checkUserFlood stays false up to the threshold, then trips on the next message", async () => {
    const chatId = -100;
    const userId = 10;
    for (let i = 0; i < FLOOD_MAX_MESSAGES; i++) {
      expect(await checkUserFlood(chatId, userId)).toBe(false);
    }
    expect(await checkUserFlood(chatId, userId)).toBe(true);
  });

  it("checkDuplicateFlood ignores short text and trips only after the threshold", async () => {
    expect(await checkDuplicateFlood(-101, "short")).toBe(false);
    const text = "this is a sufficiently long duplicate message";
    for (let i = 0; i < DUPLICATE_MAX_COUNT; i++) {
      expect(await checkDuplicateFlood(-101, text)).toBe(false);
    }
    expect(await checkDuplicateFlood(-101, text)).toBe(true);
  });

  it("checkRaid stays false up to the threshold, then trips on the next join", async () => {
    const chatId = -102;
    for (let i = 0; i < RAID_JOIN_THRESHOLD - 1; i++) {
      expect(await checkRaid(chatId)).toBe(false);
    }
    expect(await checkRaid(chatId)).toBe(true);
  });
});

describe("peekUserFloodCount / peekDuplicateFloodCount (read-only, for scoring.ts)", () => {
  it("reflects the current count without incrementing it", async () => {
    const chatId = -103;
    const userId = 20;
    await checkUserFlood(chatId, userId);
    await checkUserFlood(chatId, userId);
    expect(await peekUserFloodCount(chatId, userId)).toBe(2);
    // A second peek must not bump the count further.
    expect(await peekUserFloodCount(chatId, userId)).toBe(2);
  });

  it("returns 0 for a user/text never seen", async () => {
    expect(await peekUserFloodCount(-104, 999)).toBe(0);
    expect(await peekDuplicateFloodCount(-104, "never seen before, long enough")).toBe(0);
  });

  it("peekDuplicateFloodCount ignores short text like checkDuplicateFlood does", async () => {
    expect(await peekDuplicateFloodCount(-105, "short")).toBe(0);
  });
});

describe("isWithinNewMemberWindow (read-only, for scoring.ts's new-account modifier)", () => {
  it("is false for a member never marked", async () => {
    expect(await isWithinNewMemberWindow(-1, 999)).toBe(false);
  });

  it("is true after markNewMember and stays true across repeated checks (unlike consumeNewMemberFlag)", async () => {
    await markNewMember(-1, 3);
    expect(await isWithinNewMemberWindow(-1, 3)).toBe(true);
    expect(await isWithinNewMemberWindow(-1, 3)).toBe(true);
  });

  it("stays true even after the one-shot flag has been consumed — the two keys are independent", async () => {
    await markNewMember(-1, 4);
    expect(await consumeNewMemberFlag(-1, 4)).toBe(true);
    expect(await consumeNewMemberFlag(-1, 4)).toBe(false);
    expect(await isWithinNewMemberWindow(-1, 4)).toBe(true);
  });
});

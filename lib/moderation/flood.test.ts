import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/db/fakeRedis";
import { DUPLICATE_MAX_COUNT, FLOOD_MAX_MESSAGES, RAID_JOIN_THRESHOLD } from "./spamDict";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { checkDuplicateFlood, checkRaid, checkUserFlood, consumeNewMemberFlag, markNewMember } = await import(
  "./flood"
);

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

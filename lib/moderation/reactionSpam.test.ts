import { describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/db/fakeRedis";
import { REACTION_FLOOD_MAX } from "./spamDict";

const fake = new FakeRedis();
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => fake },
}));

const { checkReactionFlood } = await import("./reactionSpam");

describe("checkReactionFlood", () => {
  it("stays false up to the threshold, then trips on the next reaction", async () => {
    const chatId = -200;
    const userId = 20;
    for (let i = 0; i < REACTION_FLOOD_MAX; i++) {
      expect(await checkReactionFlood(chatId, userId)).toBe(false);
    }
    expect(await checkReactionFlood(chatId, userId)).toBe(true);
  });

  it("tracks each user/chat independently", async () => {
    for (let i = 0; i < REACTION_FLOOD_MAX; i++) {
      await checkReactionFlood(-201, 21);
    }
    expect(await checkReactionFlood(-201, 21)).toBe(true);
    expect(await checkReactionFlood(-201, 22)).toBe(false);
    expect(await checkReactionFlood(-202, 21)).toBe(false);
  });
});

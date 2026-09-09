import { describe, it, expect } from "vitest";
import { buildAllowlistMatcher } from "./allowlist";
import { detectSpam } from "./spam";
import { detectProfanity } from "./profanity";
import type { Message } from "grammy/types";

function textMessage(text: string, extra: Partial<Message> = {}): Message {
  return { message_id: 1, date: 0, chat: { id: -1, type: "supergroup", title: "t" }, text, ...extra } as Message;
}

describe("buildAllowlistMatcher", () => {
  it("classifies domain vs phrase entries", () => {
    const m = buildAllowlistMatcher(["example.com", "t.me/mychannel", "хорошая скидка"]);
    expect(m.empty).toBe(false);
    expect(m.allowsHost("example.com")).toBe(true);
    expect(m.allowsHost("sub.example.com")).toBe(true);
    expect(m.allowsHost("notexample.com")).toBe(false);
    expect(m.allowsHost("t.me")).toBe(false);
    expect(m.allowsPhrase("хорошая скидка")).toBe(true);
    expect(m.textHasAllowedPhrase("сегодня хорошая скидка на всё")).toBe(true);
  });

  it("is empty for no entries", () => {
    expect(buildAllowlistMatcher([]).empty).toBe(true);
    expect(buildAllowlistMatcher(undefined).empty).toBe(true);
  });
});

describe("detectSpam with allowlist", () => {
  it("suppresses the link-count signal for allowlisted hosts only", () => {
    const msg = textMessage("смотрите https://shop.example.com/a https://example.com/b");
    expect(detectSpam(msg).matched).toBe(true); // 2 links trips LINK_COUNT_THRESHOLD
    expect(detectSpam(msg, ["example.com"]).matched).toBe(false);
  });

  it("does NOT disable filtering wholesale — other spam in the same message still caught", () => {
    const msg = textMessage(
      "акция https://example.com/x https://a-xxx.ru/1 https://b-yyy.ru/2 https://c-zzz.ru/3"
    );
    // allowlisting example.com must not let the 3 other links through
    expect(detectSpam(msg, ["example.com"]).matched).toBe(true);
  });
});

describe("detectProfanity with allowlist", () => {
  it("skips a custom-word match covered by an allowlisted phrase", () => {
    expect(detectProfanity("это лох", ["лох"]).matched).toBe(true);
    expect(detectProfanity("это лох", ["лох"], ["это лох"]).matched).toBe(false);
  });
});

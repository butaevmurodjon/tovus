import { describe, expect, it } from "vitest";
import { messageCaptchaUrl, parseMessageCaptchaPayload, randomWord } from "./captcha";

// These cover only the pure, no-I/O pieces of the "message" captcha type,
// same scope as the existing captcha.test.ts (normalizeRulesText) and
// joinRequestCaptcha.test.ts (randomMathQuestion) — the Redis-touching half
// (startMessageCaptchaDm/verifyMessageCaptcha, which call sadd/srem/ttl on
// the pendingSetKey/state) isn't covered here because lib/db/fakeRedis.ts
// doesn't implement those methods yet (it only has get/set/del/exists/
// hincrby/hgetall/expire/eval) — extending that shared fixture was out of
// scope for this change. See the "message" captcha section of
// lib/telegram/bot.ts + commands.ts for the integration, exercised so far
// only by tsc/eslint and manual review, not an automated end-to-end test.

describe("randomWord", () => {
  it("is always WORD_LENGTH characters from the unambiguous alphabet", () => {
    const ambiguous = /[0O1IL]/;
    for (let i = 0; i < 200; i++) {
      const word = randomWord();
      expect(word).toHaveLength(5);
      expect(word).toMatch(/^[0-9A-Z]+$/);
      expect(ambiguous.test(word)).toBe(false);
    }
  });

  it("is not deterministic (extremely unlikely to repeat twice in a row)", () => {
    const words = new Set(Array.from({ length: 20 }, () => randomWord()));
    expect(words.size).toBeGreaterThan(1);
  });
});

describe("messageCaptchaUrl / parseMessageCaptchaPayload round trip", () => {
  const originalUsername = process.env.TELEGRAM_BOT_USERNAME;

  it("returns null when TELEGRAM_BOT_USERNAME isn't set", () => {
    delete process.env.TELEGRAM_BOT_USERNAME;
    expect(messageCaptchaUrl(-100)).toBeNull();
    process.env.TELEGRAM_BOT_USERNAME = originalUsername;
  });

  it("builds a start=capdm_<chatId> deep link that parses back to the same chat id", () => {
    process.env.TELEGRAM_BOT_USERNAME = "TestBot";
    const url = messageCaptchaUrl(-100200300);
    expect(url).toBe("https://t.me/TestBot?start=capdm_-100200300");

    const payload = url!.split("start=")[1];
    expect(parseMessageCaptchaPayload(payload)).toBe(-100200300);
    process.env.TELEGRAM_BOT_USERNAME = originalUsername;
  });

  it("rejects payloads that aren't the capdm_ shape", () => {
    expect(parseMessageCaptchaPayload("appeal_-100")).toBeNull();
    expect(parseMessageCaptchaPayload("capdm_")).toBeNull();
    expect(parseMessageCaptchaPayload("capdm_abc")).toBeNull();
    expect(parseMessageCaptchaPayload(null)).toBeNull();
    expect(parseMessageCaptchaPayload(undefined)).toBeNull();
  });
});

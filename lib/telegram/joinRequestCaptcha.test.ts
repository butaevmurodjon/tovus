import { describe, expect, it } from "vitest";
import { randomMathQuestion } from "./joinRequestCaptcha";

// Same scope as captcha.test.ts: only the pure logic gets a unit test here —
// startJoinRequestCaptcha/verifyJoinRequestCaptcha/sweepExpiredJoinRequestCaptchas
// all hit Redis + the Telegram API directly and this codebase doesn't mock
// either in unit tests (see captcha.test.ts's own scope).
describe("randomMathQuestion", () => {
  it("the correct answer is actually a + b", () => {
    for (let i = 0; i < 50; i++) {
      const { a, b, correct } = randomMathQuestion();
      expect(correct).toBe(a + b);
    }
  });

  it("options contains the correct answer plus 3 distinct, non-negative distractors", () => {
    for (let i = 0; i < 50; i++) {
      const { correct, options } = randomMathQuestion();
      expect(options).toHaveLength(4);
      expect(new Set(options).size).toBe(4);
      expect(options).toContain(correct);
      for (const value of options) expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

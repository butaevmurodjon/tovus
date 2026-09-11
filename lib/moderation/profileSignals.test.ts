import { describe, expect, it } from "vitest";
import type { User } from "grammy/types";
import { detectBadProfileSignal } from "./profileSignals";

function user(overrides: Partial<User>): User {
  return { id: 999, is_bot: false, first_name: "Test", ...overrides } as User;
}

describe("detectBadProfileSignal", () => {
  it("does not flag an ordinary name", () => {
    expect(detectBadProfileSignal(user({ first_name: "Алишер", last_name: "Каримов", username: "alisher_k" }))).toBeNull();
  });

  it("flags obscene language in the display name", () => {
    const reason = detectBadProfileSignal(user({ first_name: "хуй", last_name: undefined }));
    expect(reason).toContain("нецензурн");
  });

  it("flags obscene language in the username", () => {
    const reason = detectBadProfileSignal(user({ first_name: "Anon", username: "pizda_forever" }));
    expect(reason).toContain("нецензурн");
  });

  it("flags a scam/earn-fast bio phrase", () => {
    const reason = detectBadProfileSignal(user({ first_name: "Пассивный доход от 500$", username: undefined }));
    expect(reason).toContain("скам");
  });

  it("flags a sexual-solicitation bio phrase", () => {
    const reason = detectBadProfileSignal(user({ first_name: "Интим услуги", username: undefined }));
    expect(reason).toContain("интим");
  });

  it("does not flag ordinary words that happen to overlap loosely (e.g. a real profession)", () => {
    expect(detectBadProfileSignal(user({ first_name: "Дмитрий", last_name: "Трейдер", username: undefined }))).toBeNull();
  });

  it("returns null for a user with no name/username at all", () => {
    expect(detectBadProfileSignal(user({ first_name: "", username: undefined }))).toBeNull();
  });
});

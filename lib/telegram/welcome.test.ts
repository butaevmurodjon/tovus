import { describe, expect, it } from "vitest";
import type { User } from "grammy/types";
import { buildWelcomeText, MAX_WELCOME_MESSAGE_LENGTH, normalizeWelcomeMessage } from "./welcome";

const user: User = { id: 42, is_bot: false, first_name: "Тест" };

describe("buildWelcomeText", () => {
  it("escapes stray HTML in the admin's template instead of letting it break parse_mode: HTML (regression)", () => {
    const text = buildWelcomeText("Добро пожаловать <3, {user}!", user);
    expect(text).not.toContain("<3");
    expect(text).toContain("&lt;3");
  });

  it("still substitutes {user} with a real, unescaped mention link", () => {
    const text = buildWelcomeText("Привет, {user}!", user);
    expect(text).toContain(`<a href="tg://user?id=${user.id}">`);
  });

  it("escapes a template that looks like an unclosed tag", () => {
    const text = buildWelcomeText("<b>Welcome", user);
    expect(text).toBe("&lt;b&gt;Welcome");
  });
});

describe("normalizeWelcomeMessage", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeWelcomeMessage("  hi  ")).toBe("hi");
  });

  it("caps length so an overlong message can't hit Telegram's own length limit (regression)", () => {
    const huge = "a".repeat(10_000);
    const normalized = normalizeWelcomeMessage(huge);
    expect(normalized.length).toBe(MAX_WELCOME_MESSAGE_LENGTH);
  });
});

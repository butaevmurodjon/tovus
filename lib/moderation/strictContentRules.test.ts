import { describe, it, expect } from "vitest";
import type { Message } from "grammy/types";
import { detectStrictContentViolation } from "./strictContentRules";

function textMessage(text: string, extra: Partial<Message> = {}): Message {
  return { message_id: 1, date: 0, chat: { id: -1, type: "supergroup", title: "t" }, text, ...extra } as Message;
}

describe("detectStrictContentViolation", () => {
  it("returns null when no rules are configured", () => {
    expect(detectStrictContentViolation(textMessage("https://example.com"), [])).toBeNull();
  });

  it("flags any link when 'links' is on", () => {
    expect(detectStrictContentViolation(textMessage("зайди на https://example.com"), ["links"])).toMatch(/ссылка/);
    expect(detectStrictContentViolation(textMessage("просто текст"), ["links"])).toBeNull();
  });

  it("exempts an allowlisted link from the 'links' rule", () => {
    const msg = textMessage("зайди на https://example.com");
    expect(detectStrictContentViolation(msg, ["links"], ["example.com"])).toBeNull();
  });

  it("flags forwards when 'forwards' is on", () => {
    const msg = textMessage("hi", { forward_origin: { type: "user", date: 0, sender_user: { id: 1, is_bot: false, first_name: "a" } } } as never);
    expect(detectStrictContentViolation(msg, ["forwards"])).toMatch(/пересланное/);
  });

  it("flags channel-identity posts when 'channels' is on, but not the linked channel's auto-forward", () => {
    const senderChat = { id: -2, type: "channel", title: "c" } as Message["sender_chat"];
    const asChannel = textMessage("post", { sender_chat: senderChat });
    expect(detectStrictContentViolation(asChannel, ["channels"])).toMatch(/канала/);

    const autoForward = textMessage("post", { sender_chat: senderChat, is_automatic_forward: true });
    expect(detectStrictContentViolation(autoForward, ["channels"])).toBeNull();
  });

  it("flags any @mention when 'mentions' is on", () => {
    const msg = textMessage("привет @someone", {
      entities: [{ type: "mention", offset: 7, length: 8 }],
    });
    expect(detectStrictContentViolation(msg, ["mentions"])).toMatch(/упоминание/);
  });

  it("flags ALL-CAPS text when 'caps' is on, ignoring short strings", () => {
    expect(detectStrictContentViolation(textMessage("ЭТО ПОЛНОСТЬЮ ЗАГЛАВНЫЙ ТЕКСТ"), ["caps"])).toMatch(/заглавными/);
    expect(detectStrictContentViolation(textMessage("OK"), ["caps"])).toBeNull();
    expect(detectStrictContentViolation(textMessage("Обычный текст"), ["caps"])).toBeNull();
  });

  it("checks rules in order and returns the first match", () => {
    const msg = textMessage("ссылка https://example.com");
    expect(detectStrictContentViolation(msg, ["forwards", "links"])).toMatch(/ссылка/);
  });
});

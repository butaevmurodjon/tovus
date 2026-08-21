import { describe, expect, it } from "vitest";
import type { Message, MessageEntity } from "grammy/types";
import { detectRestrictedContent } from "./newMemberGuard";

function msg(overrides: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "supergroup", title: "t" },
    ...overrides,
  } as unknown as Message;
}

describe("detectRestrictedContent", () => {
  it("flags a forwarded message", () => {
    const result = detectRestrictedContent(
      msg({ text: "hi", forward_origin: {} as Message["forward_origin"] })
    );
    expect(result).toBe("новый участник: пересланное сообщение");
  });

  it("flags a message containing a link", () => {
    const entities: MessageEntity[] = [{ type: "url", offset: 0, length: 19 }];
    const result = detectRestrictedContent(msg({ text: "https://example.com", entities }));
    expect(result).toBe("новый участник: ссылка");
  });

  it("flags a photo attachment", () => {
    const result = detectRestrictedContent(
      msg({ photo: [{ file_id: "f1", file_unique_id: "u1", width: 10, height: 10 }] })
    );
    expect(result).toBe("новый участник: медиа-вложение");
  });

  it("flags a sticker attachment", () => {
    const result = detectRestrictedContent(
      msg({
        sticker: {
          file_id: "f1",
          file_unique_id: "u1",
          width: 10,
          height: 10,
          is_animated: false,
          is_video: false,
          type: "regular",
        },
      })
    );
    expect(result).toBe("новый участник: медиа-вложение");
  });

  it("does not flag plain text", () => {
    const result = detectRestrictedContent(msg({ text: "привет всем!" }));
    expect(result).toBeNull();
  });

  it("does not flag an empty/caption-less message with no attachment", () => {
    const result = detectRestrictedContent(msg({}));
    expect(result).toBeNull();
  });
});

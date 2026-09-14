import { describe, it, expect } from "vitest";
import type { Message } from "grammy/types";
import { isTooFastFirstComment } from "./antiFirstComment";

function commentOn(replyDate: number, commentDate: number, isAutomaticForward = true): Message {
  return {
    message_id: 2,
    date: commentDate,
    chat: { id: -1, type: "supergroup", title: "t" },
    text: "hi",
    reply_to_message: {
      message_id: 1,
      date: replyDate,
      chat: { id: -1, type: "supergroup", title: "t" },
      is_automatic_forward: isAutomaticForward,
    },
  } as unknown as Message;
}

describe("isTooFastFirstComment", () => {
  it("flags a comment posted seconds after the channel post", () => {
    expect(isTooFastFirstComment(commentOn(1000, 1005))).toBe(true);
  });

  it("does not flag a comment posted well after the window", () => {
    expect(isTooFastFirstComment(commentOn(1000, 1000 + 60))).toBe(false);
  });

  it("does not flag a reply that isn't to an automatic-forward channel post", () => {
    expect(isTooFastFirstComment(commentOn(1000, 1001, false))).toBe(false);
  });

  it("does not flag a message with no reply at all", () => {
    const msg = { message_id: 1, date: 1000, chat: { id: -1, type: "supergroup", title: "t" }, text: "hi" } as Message;
    expect(isTooFastFirstComment(msg)).toBe(false);
  });

  it("respects a custom window", () => {
    expect(isTooFastFirstComment(commentOn(1000, 1010), 5)).toBe(false);
    expect(isTooFastFirstComment(commentOn(1000, 1003), 5)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseMessageLink } from "./messageLink";

describe("parseMessageLink", () => {
  it("parses a public link", () => {
    expect(parseMessageLink("https://t.me/mygroup/1234")).toEqual({
      kind: "public",
      chatRef: "mygroup",
      messageId: 1234,
    });
  });

  it("parses a public link without a scheme", () => {
    expect(parseMessageLink("t.me/mygroup/1234")).toEqual({
      kind: "public",
      chatRef: "mygroup",
      messageId: 1234,
    });
  });

  it("parses a private (internal id) link", () => {
    expect(parseMessageLink("https://t.me/c/1234567890/5555")).toEqual({
      kind: "private",
      chatRef: -1001234567890,
      messageId: 5555,
    });
  });

  it("parses a forum-topic link, taking the last segment as the message id", () => {
    expect(parseMessageLink("https://t.me/c/1234567890/12/5555")).toEqual({
      kind: "private",
      chatRef: -1001234567890,
      messageId: 5555,
    });
    expect(parseMessageLink("https://t.me/mygroup/12/5555")).toEqual({
      kind: "public",
      chatRef: "mygroup",
      messageId: 5555,
    });
  });

  it("ignores a trailing query string", () => {
    expect(parseMessageLink("https://t.me/mygroup/1234?single")).toEqual({
      kind: "public",
      chatRef: "mygroup",
      messageId: 1234,
    });
  });

  it("returns null for non-t.me input", () => {
    expect(parseMessageLink("@someuser")).toBeNull();
    expect(parseMessageLink("hello world")).toBeNull();
    expect(parseMessageLink("https://example.com/mygroup/1234")).toBeNull();
  });

  it("returns null for a malformed t.me link", () => {
    expect(parseMessageLink("https://t.me/mygroup")).toBeNull();
    expect(parseMessageLink("https://t.me/c/notanumber/1234")).toBeNull();
    expect(parseMessageLink("https://t.me/mygroup/notanumber")).toBeNull();
    expect(parseMessageLink("https://t.me/c/1234567890")).toBeNull();
  });
});

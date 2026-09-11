import { describe, expect, it } from "vitest";
import { parseProPayload, parseUnbanPayload } from "./payments";

describe("parseProPayload", () => {
  it("extracts the chat id from a well-formed payload", () => {
    expect(parseProPayload("pro:-1001234567890")).toBe(-1001234567890);
  });

  it("returns null for payloads from a different bot/feature", () => {
    expect(parseProPayload("something-else:123")).toBeNull();
    expect(parseProPayload("")).toBeNull();
  });

  it("returns null when the chat id segment isn't numeric", () => {
    expect(parseProPayload("pro:not-a-number")).toBeNull();
  });
});

describe("parseUnbanPayload", () => {
  it("extracts chatId, userId and appealId from a well-formed payload", () => {
    expect(parseUnbanPayload("unban:-1001234567890:987654321:abc123def")).toEqual({
      chatId: -1001234567890,
      userId: 987654321,
      appealId: "abc123def",
    });
  });

  it("returns null for payloads from a different bot/feature", () => {
    expect(parseUnbanPayload("pro:-100:123")).toBeNull();
    expect(parseUnbanPayload("")).toBeNull();
  });

  it("returns null when a numeric segment isn't numeric", () => {
    expect(parseUnbanPayload("unban:not-a-number:123:abc")).toBeNull();
    expect(parseUnbanPayload("unban:-100:not-a-number:abc")).toBeNull();
  });

  it("returns null when the appealId segment is missing or empty", () => {
    expect(parseUnbanPayload("unban:-100:123")).toBeNull();
    expect(parseUnbanPayload("unban:-100:123:")).toBeNull();
  });

  it("returns null for a payload with extra segments", () => {
    expect(parseUnbanPayload("unban:-100:123:abc:extra")).toBeNull();
  });
});

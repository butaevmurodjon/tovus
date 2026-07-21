import { describe, expect, it } from "vitest";
import { parseProPayload } from "./payments";

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

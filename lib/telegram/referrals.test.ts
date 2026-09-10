import { describe, expect, it } from "vitest";
import { parseRefPayload } from "./commands";

// The `?start=` payload is the one fully attacker-controlled input in the
// referral loop — anyone can send /start with any text. It must resolve to a
// plain positive Telegram user id or to nothing at all.
describe("parseRefPayload", () => {
  it("reads a well-formed ref_ payload", () => {
    expect(parseRefPayload("ref_123456789")).toBe(123456789);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRefPayload("  ref_42  ")).toBe(42);
  });

  it("rejects ref_0 — user id 0 doesn't exist and would credit a phantom inviter", () => {
    expect(parseRefPayload("ref_0")).toBeNull();
  });

  it("rejects an id past MAX_SAFE_INTEGER, which Number() would silently round", () => {
    expect(parseRefPayload("ref_9007199254740993")).toBeNull();
    expect(parseRefPayload("ref_9999999999999999999")).toBeNull();
  });

  it("ignores src_ campaign payloads (handled separately, never as a referral)", () => {
    expect(parseRefPayload("src_habr")).toBeNull();
  });

  it("rejects non-numeric, partial and decorated payloads", () => {
    expect(parseRefPayload("ref_12a")).toBeNull();
    expect(parseRefPayload("ref_-5")).toBeNull();
    expect(parseRefPayload("ref_1.5")).toBeNull();
    expect(parseRefPayload("xref_15")).toBeNull();
    expect(parseRefPayload("ref_15 ref_16")).toBeNull();
    expect(parseRefPayload("ref_")).toBeNull();
  });

  it("returns null for a bare /start with no payload", () => {
    expect(parseRefPayload("")).toBeNull();
    expect(parseRefPayload(undefined)).toBeNull();
    expect(parseRefPayload(null)).toBeNull();
  });
});

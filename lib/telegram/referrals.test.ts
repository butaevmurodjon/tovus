import { describe, expect, it } from "vitest";
import { parseAppealPayload, parseRefPayload } from "./commands";

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

// Same attacker-controlled `?start=` payload as parseRefPayload above, but the
// id here is a chat id — always negative for a supergroup — not a user id.
describe("parseAppealPayload", () => {
  it("reads a well-formed appeal_ payload with a negative supergroup chat id", () => {
    expect(parseAppealPayload("appeal_-1001234567890")).toBe(-1001234567890);
  });

  it("reads a positive chat id too (small/legacy group chats)", () => {
    expect(parseAppealPayload("appeal_123456")).toBe(123456);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseAppealPayload("  appeal_-100  ")).toBe(-100);
  });

  it("ignores ref_ and src_ payloads (handled separately)", () => {
    expect(parseAppealPayload("ref_42")).toBeNull();
    expect(parseAppealPayload("src_habr")).toBeNull();
  });

  it("rejects non-numeric, partial and decorated payloads", () => {
    expect(parseAppealPayload("appeal_12a")).toBeNull();
    expect(parseAppealPayload("appeal_1.5")).toBeNull();
    expect(parseAppealPayload("xappeal_15")).toBeNull();
    expect(parseAppealPayload("appeal_")).toBeNull();
  });

  it("returns null for a bare /start with no payload", () => {
    expect(parseAppealPayload("")).toBeNull();
    expect(parseAppealPayload(undefined)).toBeNull();
    expect(parseAppealPayload(null)).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSupportPayload, supportUrl } from "./support";

// Same attacker-controlled-input reasoning as parseAppealPayload/
// parseRefPayload's own tests (referrals.test.ts) — chatId is always
// negative for a supergroup, so the leading `-` must round-trip.
describe("parseSupportPayload", () => {
  it("reads a well-formed support_ payload with a negative group id", () => {
    expect(parseSupportPayload("support_-1001234567890")).toBe(-1001234567890);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSupportPayload("  support_-100123  ")).toBe(-100123);
  });

  it("rejects payloads for other flows (appeal_, ref_, src_)", () => {
    expect(parseSupportPayload("appeal_-100123")).toBeNull();
    expect(parseSupportPayload("ref_123")).toBeNull();
    expect(parseSupportPayload("src_habr")).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(parseSupportPayload("support_")).toBeNull();
    expect(parseSupportPayload("support_12a")).toBeNull();
    expect(parseSupportPayload("xsupport_123")).toBeNull();
  });

  it("returns null for a bare/missing payload", () => {
    expect(parseSupportPayload("")).toBeNull();
    expect(parseSupportPayload(undefined)).toBeNull();
    expect(parseSupportPayload(null)).toBeNull();
  });
});

describe("supportUrl", () => {
  const ORIGINAL_ENV = process.env.TELEGRAM_BOT_USERNAME;
  afterEach(() => {
    process.env.TELEGRAM_BOT_USERNAME = ORIGINAL_ENV;
    vi.unstubAllEnvs();
  });

  it("builds a start=support_<groupId> deep link", () => {
    process.env.TELEGRAM_BOT_USERNAME = "TovusBot";
    expect(supportUrl(-100123)).toBe("https://t.me/TovusBot?start=support_-100123");
  });

  it("returns null when the bot username isn't provisioned", () => {
    delete process.env.TELEGRAM_BOT_USERNAME;
    expect(supportUrl(-100123)).toBeNull();
  });
});

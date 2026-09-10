import { describe, expect, it } from "vitest";
import { hasReferredChat, isCreditableReferral, type ReferralRow } from "./referrals";

const row = (chatId: number): ReferralRow => ({ ts: Date.now(), chatId, title: "t" });

describe("hasReferredChat", () => {
  it("matches an already-credited chat", () => {
    expect(hasReferredChat([row(-100), row(-200)], -200)).toBe(true);
  });

  it("does not match a new chat", () => {
    expect(hasReferredChat([row(-100)], -200)).toBe(false);
  });

  it("survives a null row from a partially-decoded list", () => {
    expect(hasReferredChat([null as unknown as ReferralRow, row(-100)], -100)).toBe(true);
  });
});

describe("isCreditableReferral", () => {
  const base = {
    inviterId: 1,
    inviteeId: 2,
    chatId: -100,
    memberCount: 50,
    minMembers: 10,
    existing: [] as ReferralRow[],
  };

  it("credits a fresh, large-enough group referred by someone else", () => {
    expect(isCreditableReferral(base)).toBe(true);
  });

  it("refuses a self-referral", () => {
    expect(isCreditableReferral({ ...base, inviteeId: 1 })).toBe(false);
  });

  it("refuses a group below the member threshold", () => {
    expect(isCreditableReferral({ ...base, memberCount: 9 })).toBe(false);
  });

  it("credits a group exactly at the threshold", () => {
    expect(isCreditableReferral({ ...base, memberCount: 10 })).toBe(true);
  });

  it("fails closed when the member count is unknown", () => {
    // null = the getChatMemberCount lookup failed. Treating that as "small
    // group, count it" would make farming trivial whenever the API hiccups.
    expect(isCreditableReferral({ ...base, memberCount: null })).toBe(false);
  });

  it("refuses the same chat twice for the same inviter", () => {
    expect(isCreditableReferral({ ...base, existing: [row(-100)] })).toBe(false);
  });

  it("still credits a different chat for an inviter who already has one", () => {
    expect(isCreditableReferral({ ...base, chatId: -300, existing: [row(-100)] })).toBe(true);
  });

  it("refuses non-integer ids (a mangled ref_ payload)", () => {
    expect(isCreditableReferral({ ...base, inviterId: Number.NaN })).toBe(false);
    expect(isCreditableReferral({ ...base, inviterId: 1.5 })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { User } from "grammy/types";
import { matchesAnyAdminIdentity } from "./impersonation";
import type { AdminIdentity } from "@/lib/db/admins";

function user(overrides: Partial<User>): User {
  return { id: 999, is_bot: false, first_name: "Test", ...overrides } as User;
}

describe("matchesAnyAdminIdentity", () => {
  const admins: Record<number, AdminIdentity> = {
    1: { name: "Ivan Petrov", username: "ivanpetrov" },
    2: { name: "Community Mod", username: null },
  };

  it("flags a near-identical display name (single-char typo)", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "Ivan", last_name: "Petro" }), admins)).toBe(true);
  });

  it("flags a near-identical username", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "Someone", username: "ivanpetrof" }), admins)).toBe(true);
  });

  it("does not flag an unrelated name", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "Alex", last_name: "Novak" }), admins)).toBe(false);
  });

  it("does not flag when there are no admins", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "Ivan", last_name: "Petrov" }), {})).toBe(false);
  });

  it("does not compare against the joining user's own admin entry", () => {
    expect(matchesAnyAdminIdentity(user({ id: 1, first_name: "Ivan", last_name: "Petrov" }), admins)).toBe(false);
  });

  it("skips short names to avoid coincidental short-string matches", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "Al" }), { 1: { name: "Al", username: null } })).toBe(false);
  });

  it("is case-insensitive via normalization", () => {
    expect(matchesAnyAdminIdentity(user({ first_name: "IVAN", last_name: "PETROV" }), admins)).toBe(true);
  });
});

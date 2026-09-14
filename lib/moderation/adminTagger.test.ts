import { describe, it, expect } from "vitest";
import { containsAdminTag } from "./adminTagger";

describe("containsAdminTag", () => {
  it("matches @admin and its Russian spelling, case-insensitively", () => {
    expect(containsAdminTag("@admin помогите")).toBe(true);
    expect(containsAdminTag("эй @Admin")).toBe(true);
    expect(containsAdminTag("@админ, забанили не того")).toBe(true);
    expect(containsAdminTag("@АДМИН")).toBe(true);
  });

  it("does not match a real different username or plain word", () => {
    expect(containsAdminTag("@administrator_ivan")).toBe(false);
    expect(containsAdminTag("администратор группы молодец")).toBe(false);
    expect(containsAdminTag("no admin mentioned here")).toBe(false);
  });

  it("matches even mid-sentence, bounded by non-word characters", () => {
    expect(containsAdminTag("привет,@admin!")).toBe(true);
  });
});

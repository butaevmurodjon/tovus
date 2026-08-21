import { describe, expect, it } from "vitest";
import { normalizeMessageText } from "./normalize";

describe("normalizeMessageText", () => {
  it("lowercases", () => {
    expect(normalizeMessageText("Admin")).toBe("admin");
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeMessageText("  Ivan   Petrov  ")).toBe("ivan petrov");
  });

  it("applies NFKC so visually-equivalent compatibility forms compare equal", () => {
    // U+FF21 (fullwidth "A") vs U+0041 ("A") — distinct code points, same NFKC form.
    expect(normalizeMessageText("Ａdmin")).toBe(normalizeMessageText("Admin"));
  });
});

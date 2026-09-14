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

  it("folds squared/negative-circled/negative-squared letter-emoji to plain letters (NFKC alone does not)", () => {
    // Confirm NFKC really leaves these untouched on its own — otherwise the
    // fold step would be dead code.
    expect("🆂".normalize("NFKC")).toBe("🆂");

    const squared = "🅂🄿🄰🄼"; // SQUARED LATIN CAPITAL LETTER S,P,A,M
    const negCircled = "🅢🅟🅐🅜"; // NEGATIVE CIRCLED LATIN CAPITAL LETTER S,P,A,M
    const negSquared = "🆂🅿🅰🅼"; // NEGATIVE SQUARED LATIN CAPITAL LETTER S,P,A,M
    expect(normalizeMessageText(squared)).toBe("spam");
    expect(normalizeMessageText(negCircled)).toBe("spam");
    expect(normalizeMessageText(negSquared)).toBe("spam");
  });

  it("leaves ordinary emoji outside the enclosed-letter ranges untouched", () => {
    expect(normalizeMessageText("привет 🔥")).toBe("привет 🔥");
  });
});

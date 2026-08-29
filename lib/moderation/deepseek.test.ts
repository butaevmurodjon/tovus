import { describe, expect, it } from "vitest";
import { buildDeepseekUserContent, parseDeepseekContent } from "./deepseek";

describe("buildDeepseekUserContent", () => {
  it("returns bare own text when there is no quote", () => {
    expect(buildDeepseekUserContent("привет всем")).toBe("привет всем");
    expect(buildDeepseekUserContent("привет", undefined)).toBe("привет");
    expect(buildDeepseekUserContent("привет", "   ")).toBe("привет");
  });

  it("fences the quoted fragment and labels it as untrusted data", () => {
    const out = buildDeepseekUserContent("спс, работает", "🔥 Казино X — заноси, выводи без проблем");
    expect(out).toContain("Собственный текст участника: ");
    expect(out).toContain("BEGIN QUOTED-FRAGMENT");
    expect(out).toContain("END QUOTED-FRAGMENT");
    expect(out).toContain("Казино X");
  });

  it("notes when the member added no text of their own", () => {
    const out = buildDeepseekUserContent("", "переходи на канал @promo, там раздают");
    expect(out).toContain("(участник не добавил своего текста)");
    expect(out).toContain("@promo");
  });

  it("caps own text at 2000 and the quote at 900 chars so the budget check sees the real size", () => {
    const out = buildDeepseekUserContent("a".repeat(5000), "b".repeat(5000));
    expect(out).toContain(`"${"a".repeat(2000)}"`);
    expect(out).not.toContain("a".repeat(2001));
    expect(out).toContain("b".repeat(900));
    expect(out).not.toContain("b".repeat(901));
  });
});

describe("parseDeepseekContent", () => {
  it("parses a spam violation", () => {
    const result = parseDeepseekContent(
      JSON.stringify({ violation: true, category: "spam", reason: "реклама заработка" })
    );
    expect(result).toEqual({ violation: true, category: "spam", reason: "реклама заработка" });
  });

  it("parses a scam violation", () => {
    const result = parseDeepseekContent(
      JSON.stringify({ violation: true, category: "scam", reason: "фейковый саппорт" })
    );
    expect(result).toEqual({ violation: true, category: "scam", reason: "фейковый саппорт" });
  });

  it("parses a profanity violation", () => {
    const result = parseDeepseekContent(
      JSON.stringify({ violation: true, category: "profanity", reason: "нецензурная лексика" })
    );
    expect(result).toEqual({ violation: true, category: "profanity", reason: "нецензурная лексика" });
  });

  it("parses a non-violation", () => {
    const result = parseDeepseekContent(
      JSON.stringify({ violation: false, category: "none", reason: "не является нарушением" })
    );
    expect(result).toEqual({ violation: false, category: "none", reason: "не является нарушением" });
  });

  it("falls back category to none on an unknown value", () => {
    const result = parseDeepseekContent(JSON.stringify({ violation: true, category: "malware", reason: "x" }));
    expect(result).toEqual({ violation: true, category: "none", reason: "x" });
  });

  it("defaults reason to empty string when missing", () => {
    const result = parseDeepseekContent(JSON.stringify({ violation: false, category: "none" }));
    expect(result).toEqual({ violation: false, category: "none", reason: "" });
  });

  it("returns null when violation is not a boolean", () => {
    const result = parseDeepseekContent(JSON.stringify({ violation: "true", category: "spam" }));
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseDeepseekContent("{not json")).toBeNull();
  });

  it("returns null on undefined input", () => {
    expect(parseDeepseekContent(undefined)).toBeNull();
  });
});

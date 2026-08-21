import { describe, expect, it } from "vitest";
import { parseDeepseekContent } from "./deepseek";

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

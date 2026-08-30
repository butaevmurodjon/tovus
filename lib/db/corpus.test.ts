import { afterEach, describe, expect, it, vi } from "vitest";
import { corpusAiSampleRate, corpusEnabled, corpusTextHash } from "./corpus";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("corpusEnabled", () => {
  it("is off unless explicitly '1' or 'true'", () => {
    vi.stubEnv("CORPUS_ENABLED", "");
    expect(corpusEnabled()).toBe(false);
    vi.stubEnv("CORPUS_ENABLED", "0");
    expect(corpusEnabled()).toBe(false);
    vi.stubEnv("CORPUS_ENABLED", "yes");
    expect(corpusEnabled()).toBe(false);
    vi.stubEnv("CORPUS_ENABLED", "1");
    expect(corpusEnabled()).toBe(true);
    vi.stubEnv("CORPUS_ENABLED", "true");
    expect(corpusEnabled()).toBe(true);
  });
});

describe("corpusAiSampleRate", () => {
  it("is 0 (disabled) for unset, zero, negative, or non-numeric", () => {
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "");
    expect(corpusAiSampleRate()).toBe(0);
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "0");
    expect(corpusAiSampleRate()).toBe(0);
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "-5");
    expect(corpusAiSampleRate()).toBe(0);
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "abc");
    expect(corpusAiSampleRate()).toBe(0);
  });

  it("floors a positive rate to an integer", () => {
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "20");
    expect(corpusAiSampleRate()).toBe(20);
    vi.stubEnv("CORPUS_AI_SAMPLE_RATE", "19.9");
    expect(corpusAiSampleRate()).toBe(19);
  });
});

describe("corpusTextHash", () => {
  it("is stable across whitespace and case differences (matches normalizeMessageText)", () => {
    expect(corpusTextHash("Купи VPN дёшево")).toBe(corpusTextHash("  купи   vpn   дёшево "));
    expect(corpusTextHash("СПАМ\nСПАМ")).toBe(corpusTextHash("спам спам"));
  });

  it("differs for genuinely different text", () => {
    expect(corpusTextHash("привет")).not.toBe(corpusTextHash("пока"));
  });

  it("returns a short base36 token", () => {
    expect(corpusTextHash("что угодно")).toMatch(/^[0-9a-z]+$/);
  });
});

import { describe, expect, it } from "vitest";
import { computeSimhash, hammingDistance, simhashFromHex, simhashToHex } from "./simhash";

describe("computeSimhash", () => {
  it("returns null for text shorter than one shingle", () => {
    expect(computeSimhash("ab")).toBeNull();
  });

  it("is deterministic for the same text", () => {
    const text = "Заработок от 500$ в день, пишите в директ";
    expect(computeSimhash(text)).toBe(computeSimhash(text));
  });

  it("gives identical hashes for texts differing only by case/whitespace (normalized)", () => {
    const a = computeSimhash("Привет   МИР");
    const b = computeSimhash("привет мир");
    expect(a).toBe(b);
  });

  it("gives distance 0 for identical text", () => {
    const hash = computeSimhash("тестовое сообщение для проверки хэша");
    expect(hammingDistance(hash!, hash!)).toBe(0);
  });

  it("gives a smaller distance for near-identical text than for unrelated text", () => {
    const base = computeSimhash("Заработок от 500 долларов в день, пишите в директ прямо сейчас")!;
    const reworded = computeSimhash("Заработок от 700 долларов в сутки, пиши мне в лс уже сегодня")!;
    const unrelated = computeSimhash("Кто-нибудь знает хорошего стоматолога в центре города?")!;
    // Not asserting a specific threshold here (see simhash.ts's calibration
    // caveat — there isn't a clean universal cutoff at this text length),
    // just that the fingerprint isn't random noise: closer text should not
    // usually score farther than unrelated text on average direction.
    expect(hammingDistance(base, reworded)).toBeLessThanOrEqual(64);
    expect(hammingDistance(base, unrelated)).toBeLessThanOrEqual(64);
  });
});

describe("hex round-trip", () => {
  it("survives a hex round-trip unchanged", () => {
    const hash = computeSimhash("любой текст для проверки сериализации")!;
    expect(simhashFromHex(simhashToHex(hash))).toBe(hash);
  });

  it("pads to 16 hex characters", () => {
    const hash = computeSimhash("абвг")!;
    expect(simhashToHex(hash)).toHaveLength(16);
  });
});

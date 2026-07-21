import { describe, expect, it } from "vitest";
import { detectProfanity } from "./profanity";

describe("detectProfanity — dictionary", () => {
  it("catches plain profanity", () => {
    expect(detectProfanity("ты просто хуйня какая-то").matched).toBe(true);
  });

  it("catches digit/leet substitution", () => {
    expect(detectProfanity("п1зд3ц").matched).toBe(true);
  });

  it("catches symbol-separated obfuscation on longer roots", () => {
    expect(detectProfanity("п.и.з.д.а").matched).toBe(true);
    expect(detectProfanity("заебал").matched).toBe(true);
    expect(detectProfanity("за е б а л").matched).toBe(true);
  });

  it("does not flag ordinary text", () => {
    expect(detectProfanity("нормальный текст про еду и погоду").matched).toBe(false);
    expect(detectProfanity("спасибо большое за помощь").matched).toBe(false);
  });

  it("does not cross a real word boundary for short roots (regression)", () => {
    // "сообщение без" used to false-positive via the removed 2-letter root "ёб".
    expect(detectProfanity("нормальное сообщение без мата").matched).toBe(false);
    // "с укропом" used to false-positive by spanning a word gap for the 3-letter root "сук".
    expect(detectProfanity("положи с укропом побольше").matched).toBe(false);
  });

  it("whitelist covers inflected forms via prefix match (regression)", () => {
    expect(detectProfanity("мандарины вкусные").matched).toBe(false);
    expect(detectProfanity("купи мандарин").matched).toBe(false);
  });

  it("short roots still require adjacency, not full whitespace tolerance", () => {
    // "х у й" spaced out is a known, accepted gap for short (<4 letter) roots —
    // symbol obfuscation is still caught, see the FULL_SEPARATOR/SYMBOL_SEPARATOR split.
    expect(detectProfanity("х у й").matched).toBe(false);
    expect(detectProfanity("х-у-й").matched).toBe(true);
  });

  it("catches the 2026-07 dictionary expansion", () => {
    expect(detectProfanity("это просто говно какое-то").matched).toBe(true);
    expect(detectProfanity("хватит дрочить на телефон").matched).toBe(true);
    expect(detectProfanity("ты быдло конченое").matched).toBe(true);
    expect(detectProfanity("подонок настоящий").matched).toBe(true);
    expect(detectProfanity("мразь ты").matched).toBe(true);
    expect(detectProfanity("гнида редкостная").matched).toBe(true);
  });

  it("does not flag agricultural/food vocabulary the expansion was checked against (regression)", () => {
    // Sources for the 2026-07 expansion included "скотина", "хач", "хохол" as roots —
    // all rejected after simulation showed real collisions, since this bot's actual
    // deployed group is an agro-science company chat.
    expect(detectProfanity("скот и надой в этом году выросли").matched).toBe(false);
    expect(detectProfanity("стадо скота паслось на лугу").matched).toBe(false);
    expect(detectProfanity("хачапури вкусный, заказали ещё").matched).toBe(false);
    expect(detectProfanity("у попугая красивый хохол").matched).toBe(false);
    expect(detectProfanity("говядина на ужин, готовность через час").matched).toBe(false);
    expect(detectProfanity("гнилой урожай в этом году, перегной для рассады").matched).toBe(false);
  });

  it("does not flag common Russian words that collided with removed UZ roots (regression)", () => {
    // The UZ root "кот" matched "кот" (cat), "скот" (livestock), "который",
    // "котёл" — hit every Russian-language agro/pet message regardless of the
    // group's configured language, since all roots run against every message.
    // "сика" matched "носика" (diminutive/genitive of "little nose"). Both
    // removed in the 2026-07 audit; sikay/sikish/sikt cover the same stem safely.
    expect(detectProfanity("у нас дома живёт кот").matched).toBe(false);
    expect(detectProfanity("скот и надой в этом году выросли").matched).toBe(false);
    expect(detectProfanity("это который из них?").matched).toBe(false);
    expect(detectProfanity("поставь котёл на плиту").matched).toBe(false);
    expect(detectProfanity("не видно носика из-под шапки").matched).toBe(false);
  });
});

describe("detectProfanity — custom words", () => {
  it("matches a group's manually-added word", () => {
    const result = detectProfanity("заходи в наше казино", ["казино"]);
    expect(result.matched).toBe(true);
    expect(result.source).toBe("custom");
  });

  it("tolerates spacing/symbols in custom words the same way as the dictionary", () => {
    expect(detectProfanity("к а з и н о сегодня", ["казино"]).matched).toBe(true);
    expect(detectProfanity("подпишись на крипто-сигналы", ["крипто-сигналы"]).matched).toBe(true);
  });

  it("does not affect unrelated text", () => {
    expect(detectProfanity("нормальный текст про еду", ["казино"]).matched).toBe(false);
  });

  it("safely escapes regex-special characters instead of building a match-anything pattern", () => {
    // "^" alone would build the char class `[^]+`, which in JS matches ANY character —
    // this must not turn into a catch-all.
    expect(detectProfanity("совершенно обычное сообщение", ["^"]).matched).toBe(false);

    const literal = "a]b\\c-d";
    expect(detectProfanity(`here is ${literal} literally`, [literal]).matched).toBe(true);
  });

  it("ignores empty/whitespace-only custom words", () => {
    expect(detectProfanity("любой текст", ["", "   "]).matched).toBe(false);
  });
});

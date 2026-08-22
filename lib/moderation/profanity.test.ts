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
  });

  it("does not tolerate a literal space between letters, even for longer roots (regression)", () => {
    // 2026-08 audit: whitespace tolerance for 4+ letter roots was removed
    // entirely — "ебан"/"ебал" were spanning real word gaps ("целы[е] [бан]ки",
    // "хороши[е] [бал]лы"), see the cross-word-boundary test below. Deliberate
    // trade-off: this specific spaced-out evasion is no longer caught here,
    // symbol obfuscation ("х-у-й" etc.) still is, and this is a much rarer
    // real evasion pattern than the false positives it was causing.
    expect(detectProfanity("за е б а л").matched).toBe(false);
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

  it("does not flag real production messages that were false-flagged as profanity (regression)", () => {
    // 2026-08 audit — three real user reports, all flagged with reason
    // "нецензурная лексика" despite containing no profanity:
    expect(
      detectProfanity("Дождь будет😁 WB taxi едет только деньги с карты сразу списали🙄").matched
    ).toBe(false);
    expect(detectProfanity("Мне целые банки пришли, я про Махеев").matched).toBe(false);
    expect(
      detectProfanity(
        "Доброй ночи. Так акция есть или закончилась? Я смогу использовать свои 50000? Или откажут?"
      ).matched
    ).toBe(false);
    // Same root ("сра") flagged a fourth real message reported right after the fix started.
    expect(detectProfanity("Я как увидела сразу про вас подумала").matched).toBe(false);
  });

  it("does not flag common Russian words colliding with the 2026-08-removed/tightened roots (regression)", () => {
    // "сра" (→ "срал"/"срат") used to match inside "сразу"/"сравнили"/"сражение".
    expect(detectProfanity("курс доллара сразу вырос").matched).toBe(false);
    expect(detectProfanity("мы сравнили цены в двух магазинах").matched).toBe(false);
    expect(detectProfanity("это было настоящее сражение за победу").matched).toBe(false);
    // "муд" (redundant with мудак/мудил, now removed) used to match "мудрый"/"мудрость".
    expect(detectProfanity("она была очень мудрой женщиной, полной мудрости").matched).toBe(false);
    expect(detectProfanity("мудрец сказал важную вещь").matched).toBe(false);
    // "конч" (removed — too polysemous for a regex to disambiguate) used to
    // match the ordinary "to end/run out" sense of кончить(ся).
    expect(detectProfanity("собрание закончилось поздно, все устали").matched).toBe(false);
    expect(detectProfanity("кончилось молоко, надо купить").matched).toBe(false);
    expect(detectProfanity("договор кончился в среду").matched).toBe(false);
    // "хер" matching the city name "Херсон" — fixed via whitelist, not root removal.
    expect(detectProfanity("Херсон сегодня в новостях").matched).toBe(false);
    // "манда" matching mid-word inside "команда"/"командир" — fixed via whitelist.
    expect(detectProfanity("наша команда выиграла матч, командир гордился").matched).toBe(false);
    // Actual profanity forms these changes must still catch.
    expect(detectProfanity("мудак ты редкостный").matched).toBe(true);
    expect(detectProfanity("манда твоя").matched).toBe(true);
    expect(detectProfanity("ты просто мудило").matched).toBe(true);
  });

  it("does not flag a 4+ letter root spanning a real word gap (regression)", () => {
    // Root "ебан"/"ебал" were eating the space between an unrelated word ending
    // in "е" and the next word starting with "бан"/"бал" — this is the same
    // class of bug the short-root whitespace restriction already guarded
    // against, just not caught for longer roots until the 2026-08 audit.
    expect(detectProfanity("Хорошие баллы получили почти все").matched).toBe(false);
    expect(detectProfanity("Прекрасные балы устраивали в 19 веке").matched).toBe(false);
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

  it("tolerates symbol obfuscation in custom words the same way as the dictionary", () => {
    expect(detectProfanity("подпишись на крипто-сигналы", ["крипто-сигналы"]).matched).toBe(true);
  });

  it("does not tolerate a literal space in custom words either (regression)", () => {
    // Same 2026-08 whitespace-tolerance removal as the dictionary — an admin-entered
    // word carries the identical cross-word collision risk as a dictionary root.
    expect(detectProfanity("к а з и н о сегодня", ["казино"]).matched).toBe(false);
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

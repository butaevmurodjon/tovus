import { describe, expect, it } from "vitest";
import { guessLang } from "./langGuess";

describe("guessLang", () => {
  it("returns 'other' for empty / punctuation-only text", () => {
    expect(guessLang("")).toBe("other");
    expect(guessLang("   ")).toBe("other");
    expect(guessLang("!!! ??? …")).toBe("other");
    expect(guessLang("😀🔥👍")).toBe("other");
  });

  it("classifies plain Russian Cyrillic as 'ru'", () => {
    expect(guessLang("привет всем, как дела")).toBe("ru");
    expect(guessLang("Сегодня хорошая погода на улице")).toBe("ru");
    expect(guessLang("кто знает где купить билеты")).toBe("ru");
  });

  it("classifies Uzbek Cyrillic (ў ғ қ ҳ) as 'uz-cyrl'", () => {
    expect(guessLang("менга ёзинг, тез орада даромад бўлади")).toBe("uz-cyrl");
    expect(guessLang("каналга обуна бўлинг ва пул топинг")).toBe("uz-cyrl");
    expect(guessLang("ҳаммага салом, яхшимисиз")).toBe("uz-cyrl");
  });

  it("classifies Uzbek Latin as 'uz-latin'", () => {
    expect(guessLang("menga yozing, tez orada daromad bo'ladi")).toBe("uz-latin");
    expect(guessLang("hammaga salom, bu yerda nima gap")).toBe("uz-latin");
    expect(guessLang("kanalga obuna bo'ling va pul toping")).toBe("uz-latin");
  });

  it("does not mistake plain English for uz-latin", () => {
    expect(guessLang("hey guys how are you doing today")).toBe("other");
    expect(guessLang("please send me the report by tomorrow")).toBe("other");
  });

  it("picks the leading script on mixed text, Cyrillic wins ties", () => {
    // Latin brand name inside Russian text -> still ru
    expect(guessLang("скачивай наше приложение VanyaVPN бесплатно")).toBe("ru");
    // uz-cyrl markers survive an embedded Latin token
    expect(guessLang("VPN ни бўшатиб олинг ҳозироқ")).toBe("uz-cyrl");
  });
});

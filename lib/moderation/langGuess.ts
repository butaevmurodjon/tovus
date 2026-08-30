/**
 * Heuristic language/script guess for a message's OWN TEXT — distinct from
 * i18n's detectLang (which reads Telegram's `language_code`, a property of the
 * sender's client, not of this message). The corpus needs to stratify by the
 * script the text is actually written in, because the whole ru / uz-cyrl /
 * uz-latin asymmetry is what the dictionaries under-cover (see spamDict.ts /
 * profanityDict.ts headers).
 *
 * Deliberately cheap and approximate: a few character-class ratios and a small
 * set of Uzbek-distinctive letters. Not a real language detector — good enough
 * to bucket a corpus row and spot "we have 5k ru samples and 40 uz-latin ones".
 */
export type LangGuess = "ru" | "uz-cyrl" | "uz-latin" | "other";

// Cyrillic letters that exist in the Uzbek Cyrillic alphabet but not Russian.
const UZ_CYRILLIC_MARKERS = /[ўғқҳ]/i;
// The oʻ / gʻ digraph is uniquely Uzbek Latin (U+02BB modifier letter, or any
// apostrophe users type in its place). "o'clock" / "g'day" are the only real
// English collisions and they're rare in these chats.
const UZ_LATIN_DIGRAPH = /[og][ʻ'`’ʼ]/i;
// Distinctive Uzbek Latin function/greeting words — deliberately excludes short
// tokens that collide with English ("men", "ham", "bu", "bor"). One hit is
// enough to call it uz-latin over "some English".
const UZ_LATIN_WORDS =
  /\b(bilan|uchun|yoki|emas|kerak|salom|rahmat|menga|sizga|bugun|yozing|obuna|guruh|kanalga|pul|daromad|ishlash)\b/i;

function ratio(text: string, re: RegExp): number {
  const total = text.replace(/\s/g, "").length;
  if (total === 0) return 0;
  return (text.match(re)?.length ?? 0) / total;
}

/** Best-effort script bucket for `text`. Empty / punctuation-only → "other". */
export function guessLang(text: string): LangGuess {
  const t = text.trim();
  if (t.length === 0) return "other";

  const cyr = ratio(t, /[а-яё]/gi);
  const lat = ratio(t, /[a-z]/gi);

  if (cyr >= 0.3 && cyr >= lat) {
    return UZ_CYRILLIC_MARKERS.test(t) ? "uz-cyrl" : "ru";
  }

  if (lat >= 0.3 && lat > cyr) {
    return UZ_LATIN_DIGRAPH.test(t) || UZ_LATIN_WORDS.test(t) ? "uz-latin" : "other";
  }

  // Mixed scripts (obfuscation, or a Latin brand name inside Cyrillic text):
  // fall back to whichever script leads, Cyrillic wins ties.
  if (cyr > 0 && cyr >= lat) {
    return UZ_CYRILLIC_MARKERS.test(t) ? "uz-cyrl" : "ru";
  }
  return "other";
}

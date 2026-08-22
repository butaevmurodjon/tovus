import {
  RU_PROFANITY_ROOTS,
  RU_WHITELIST_WORDS,
  UZ_PROFANITY_ROOTS,
} from "./profanityDict";

/** Cyrillic letter -> class of look-alike characters used to dodge naive filters. */
const LETTER_CLASSES: Record<string, string> = {
  а: "a4@а",
  б: "б6",
  в: "вv",
  г: "гg",
  д: "дd",
  е: "е3eё",
  ё: "ёе3e",
  ж: "ж",
  з: "з3z",
  и: "иi1!y",
  й: "йy",
  к: "кk",
  л: "лl1",
  м: "мm",
  н: "нn",
  о: "о0o",
  п: "пp",
  р: "рp",
  с: "сcs$",
  т: "тt7",
  у: "уyu",
  ф: "фf",
  х: "хxh",
  ц: "ц",
  ч: "ч",
  ш: "ш",
  щ: "щ",
  ъ: "ъ",
  ы: "ы",
  ь: "ь",
  э: "э3e",
  ю: "ю",
  я: "яa",
};

// Symbol-only separator: tolerates "п.и.з.д.а", "х_у_й", "х-у-й", etc. for every root.
// Deliberately NEVER matches a literal space, for any root length. Short roots
// spanning a real word gap was the original concern ("с укропом" via "сук") —
// but the 2026-08 audit found 4+ letter roots do it too: "ебан"/"ебал" (both
// well past the old 4-letter cutoff) matched across "целы[е] [бан]ки" and
// "хороши[е] [бал]лы" by eating the space between an unrelated word ending in
// "е" and the next word starting with "бан"/"бал". A root being long enough to
// "feel" specific doesn't stop it decomposing across a boundary at a common
// letter. Whitespace tolerance is retained nowhere; symbol-obfuscation (which is
// the overwhelmingly more common real evasion pattern) is still fully caught.
const SYMBOL_SEPARATOR = "[\\-_.,*'`~]{0,2}";

// Regex-special characters need escaping before landing inside a `[...]` class —
// without this, a word containing e.g. "^" would build `[^]+`, which in JS matches
// ANY character (empty negated class), turning one bad character class into a
// catch-all. Matters most for buildWordPattern's custom-word path below, since
// those characters come from admin input, not our own hardcoded dictionary.
function escapeForCharClass(ch: string): string {
  return ch.replace(/[\]\\^-]/g, "\\$&");
}

function buildWordPattern(word: string): string {
  return word
    .split("")
    .map((ch) => {
      const classChars = LETTER_CLASSES[ch] ?? ch;
      const uniq = Array.from(new Set(classChars.split(""))).map(escapeForCharClass).join("");
      return `[${uniq}]+`;
    })
    .join(SYMBOL_SEPARATOR);
}

const ALL_ROOTS = [...RU_PROFANITY_ROOTS, ...UZ_PROFANITY_ROOTS];
const PROFANITY_REGEX = new RegExp(`(${ALL_ROOTS.map(buildWordPattern).join("|")})`, "giu");
const WHITELIST_WORDS = RU_WHITELIST_WORDS.map((w) => w.toLowerCase());

/** Builds a fresh regex for a group's manually-added filter words. Small lists (a
 * few dozen words at most), so recompiling per message is cheap — no caching needed. */
export function buildCustomWordsRegex(words: string[]): RegExp | null {
  const cleaned = Array.from(
    new Set(
      words
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)
    )
  );
  if (cleaned.length === 0) return null;
  return new RegExp(`(${cleaned.map(buildWordPattern).join("|")})`, "giu");
}

/** Prefix match, not exact — Russian inflection means "мандарин" must also cover "мандарины", "мандарина", etc. */
function isWhitelistedWord(word: string): boolean {
  return WHITELIST_WORDS.some((w) => word.startsWith(w));
}

const WORD_BOUNDARY = /[^а-яёa-z0-9]/i;

function enclosingWord(text: string, index: number, length: number): string {
  let start = index;
  let end = index + length;
  while (start > 0 && !WORD_BOUNDARY.test(text[start - 1])) start--;
  while (end < text.length && !WORD_BOUNDARY.test(text[end])) end++;
  return text.slice(start, end);
}

export interface ProfanityResult {
  matched: boolean;
  snippet?: string;
  source?: "dictionary" | "custom";
}

/** `customWords` is the group's manually-added word list (see /customwords, Mini App settings). */
export function detectProfanity(rawText: string, customWords: string[] = []): ProfanityResult {
  if (!rawText) return { matched: false };
  const text = rawText.toLowerCase();

  PROFANITY_REGEX.lastIndex = 0;
  for (const match of text.matchAll(PROFANITY_REGEX)) {
    const word = enclosingWord(text, match.index, match[0].length);
    if (isWhitelistedWord(word)) continue;
    return { matched: true, snippet: match[0], source: "dictionary" };
  }

  const customRegex = buildCustomWordsRegex(customWords);
  if (customRegex) {
    const match = text.match(customRegex);
    if (match) return { matched: true, snippet: match[0], source: "custom" };
  }

  return { matched: false };
}

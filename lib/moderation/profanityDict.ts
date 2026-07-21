/**
 * Root word lists for the profanity filter. Kept as bare lowercase Cyrillic
 * roots (no endings/prefixes) — buildProfanityRegex() below expands each
 * root into a regex that tolerates letter substitution (0/о, 3/е, @/а, …)
 * and separators (spaces, dots, underscores, asterisks) used to dodge
 * naive filters. Extend these arrays to broaden coverage; no code changes
 * needed elsewhere.
 */
export const RU_PROFANITY_ROOTS: string[] = [
  "хуй",
  "хуе",
  "хуя",
  "хер",
  "пизд",
  "ебат",
  "ебал",
  "ебан",
  "ебуч",
  "уеб",
  "заеб",
  "въеб",
  "долбоеб",
  "мудак",
  "мудил",
  "муд",
  "сук",
  "бля",
  "блят",
  "гандон",
  "гондон",
  "пидор",
  "пидар",
  "пидр",
  "залуп",
  "манда",
  "шлюх",
  "чмо",
  "конч",
  "говн",
  "дроч",
  "сра",
  "бзд",
  "гнид",
  "мраз",
  "быдл",
  "сучар",
  "подон",
];

export const UZ_PROFANITY_ROOTS: string[] = [
  "жалаб",
  "қотоқ",
  "кутак",
  "қутак",
  "сикай",
  "сикиш",
  "сикт",
  "дупп",
  "тешак",
  "эшак",
  "бетавфи",
  "нахс",
  // Removed "кот" (matched "кот" [cat], "скот" [livestock], "который", "котёл" —
  // catastrophic for any Russian-language agro/pet conversation) and "сика"
  // (matched "носика", the diminutive/genitive of "little nose") after the
  // 2026-07 audit — both roots run against every message regardless of a
  // group's configured language, so any Cyrillic collision with common Russian
  // words hits everyone. sikay/sikish/sikt already cover the same verb stem
  // more specifically without the collision.
];

/** Whole words that are legitimate and must never be flagged even if a root matches inside them. */
export const RU_WHITELIST_WORDS: string[] = ["конституция", "мандарин", "хустон"];

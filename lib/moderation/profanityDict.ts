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
  "говн",
  "дроч",
  "срал",
  "срат",
  "бзд",
  "гнид",
  "мраз",
  "быдл",
  "сучар",
  "подон",
  // 2026-08 audit: removed bare "муд" (redundant — "мудак"/"мудил" already
  // cover the actual insults) and "конч" (matched "закончилась"/"кончилось"/
  // "кончился" — the innocent "to end/run out" sense of кончить(ся) is one of
  // the most common verbs in Russian and a regex can't disambiguate it from
  // the vulgar sense; left to the DeepSeek AI layer instead). Replaced bare
  // "сра" — which matched "сразу", "сравнили", "сражение" — with the longer,
  // still-inflectable stems "срал"/"срат" (срать/насрать conjugations),
  // which don't collide with those words. Same rationale as the 2026-07
  // "кот"/"сика" removal below: an overlapping short root is worse than the
  // coverage it buys, and the AI classifier is the right layer for genuinely
  // ambiguous/polysemous words.
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

/** Legitimate word/prefix families that must never be flagged even though a root
 * matches as a substring inside them (checked via startsWith, so this also covers
 * inflected forms — "командир", "команда", "команду", etc. all start with "команд").
 * "херсон" guards the city name against root "хер"; "команд" guards
 * команда/командир/командование/etc. against root "манда" appearing mid-word
 * (2026-08 audit — see profanity.ts for why these can't be fixed by anchoring alone).
 * 2026-08-24 audit (empirically verified against detectProfanity, not just read):
 * "мандат" (mandate/credentials — root "манда", е.g. "депутатский мандат");
 * "чмок" (the affectionate "чмоки"/"чмокнула" sign-off/kiss — root "чмо", one of
 * the most common casual message-enders in Russian chat); "херувим" (cherub —
 * root "хер", same collision class as "херсон"). */
export const RU_WHITELIST_WORDS: string[] = [
  "конституция",
  "мандарин",
  "хустон",
  "херсон",
  "команд",
  "мандат",
  "чмок",
  "херувим",
];

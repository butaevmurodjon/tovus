// "Enclosed Alphanumeric Supplement" letter-emoji: three contiguous A-Z
// blocks (🅰🅱🅲.../🅐🅑🅒.../🆎-style) that spam templates use to spell a word
// letter-by-letter specifically to dodge phrase dictionaries — same intent as
// the mathematical-bold/fullwidth styles below, but these do NOT get folded
// by String.prototype.normalize("NFKC") (verified empirically: unlike
// mathematical/fullwidth letters, Unicode gives these no compatibility
// decomposition, because they're emoji-presentation symbols, not just
// stylized text — see normalize.test.ts). Each block is a contiguous run in
// definition order (A=first codepoint ... Z=last), so a simple codepoint
// offset recovers the plain letter; case is irrelevant since callers
// lowercase right after. 2026-09-14: real spam report where a fancy-letter
// "free"/"бесплатно"-style pitch reached the group unflagged.
const ENCLOSED_LETTER_RANGES: Array<[number, number]> = [
  [0x1f130, 0x1f149], // Squared Latin Capital Letter A-Z
  [0x1f150, 0x1f169], // Negative Circled Latin Capital Letter A-Z
  [0x1f170, 0x1f189], // Negative Squared Latin Capital Letter A-Z (only A-Z are letters; a few extra codepoints in this block beyond Z, e.g. "🆊 WC", are left untouched below)
];

function foldEnclosedLetters(raw: string): string {
  return Array.from(raw)
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      for (const [start, end] of ENCLOSED_LETTER_RANGES) {
        if (cp >= start && cp <= start + 25 && cp <= end) {
          return String.fromCharCode(65 + (cp - start));
        }
      }
      return ch;
    })
    .join("");
}

/**
 * Minimal normalization shared by fuzzy-comparison callers (§4.3 in TZ.md).
 * Deliberately does NOT include the confusable-character substitution table
 * (0/о, 3/е, etc.) described in the full spec — that's a separate, tested
 * sub-project and isn't wired into detectProfanity/detectSpam/hashText yet.
 */
export function normalizeMessageText(raw: string): string {
  return foldEnclosedLetters(raw).normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

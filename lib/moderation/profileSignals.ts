import type { User } from "grammy/types";
import { detectProfanity } from "./profanity";
import { SCAM_PROFILE_MARKERS } from "./spamDict";
import { normalizeMessageText } from "./normalize";

/**
 * Text-only half of the "bad name/username/avatar" question — see
 * MONETIZATION.md-adjacent design note in the 2026-09-11 commit that added
 * this file. Checks a joining member's first/last name + @username for
 * obscene language or scam/sexual-solicitation bio vocabulary.
 *
 * Deliberately name/username only, NOT the avatar photo: detecting nudity or
 * a "sexual offer" in a profile picture needs a vision-capable model call on
 * every joiner's photo, which is (a) a new provider/cost decision DeepSeek
 * here doesn't cover — see lib/moderation/deepseek.ts, text-only — and (b) new
 * exposure under the same 152-ФЗ/ЗРУ-547 review MONETIZATION.md §7 already
 * flags as open for the training-corpus project: processing RU/UZ users'
 * profile photos on fra1 is a materially different risk than processing
 * message text. Left as an explicit open item, not silently skipped.
 *
 * Same "never auto-punish on this alone" rule as isLikelyAdminImpersonation
 * (impersonation.ts) and isSuspiciousJoinVelocity (userGraph.ts) — a name is
 * weak, cheaply-faked evidence (homonyms, a rude nickname someone's had for
 * years). The caller (bot.ts) only uses this to force the same captcha
 * verification a raid/impersonation match forces, plus a journal note; it
 * never deletes, mutes, or bans by itself.
 */
export function detectBadProfileSignal(member: User): string | null {
  const parts = [member.first_name, member.last_name, member.username]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ");
  if (!parts) return null;
  return matchScamOrProfanity(parts, "имя/юзернейм");
}

/**
 * Same check as detectBadProfileSignal, applied to the "About" bio text
 * instead of name/username/@handle. Split into its own function (rather than
 * folded into detectBadProfileSignal) because the bio isn't on the `User`
 * object the join update already carries — the caller has to spend an extra
 * `getChat` call to fetch it, so it's gated separately (owner's call,
 * 2026-09-11: only run for accounts that look freshly-created, see
 * accountAge.ts) instead of running unconditionally on every joiner like the
 * free name/username check above.
 */
export function detectBadBioSignal(bio: string | null | undefined): string | null {
  if (!bio || !bio.trim()) return null;
  return matchScamOrProfanity(bio, "bio");
}

function matchScamOrProfanity(text: string, label: "имя/юзернейм" | "bio"): string | null {
  if (detectProfanity(text).matched) {
    return `${label} с нецензурной лексикой`;
  }

  // NFKC first, not just .toLowerCase() — see textSignals.ts's containsCta
  // comment: bios/display names built from stylized Unicode alphabets
  // (mathematical bold, fullwidth, ...) have no case mapping, so plain
  // lowercasing leaves them unmatched against SCAM_PROFILE_MARKERS. Real
  // example: a "18+ bio" join whose entire bio text used this styling.
  const lower = normalizeMessageText(text);
  if (SCAM_PROFILE_MARKERS.some((marker) => lower.includes(marker))) {
    return `${label} похоже на скам- или интим-предложение`;
  }

  return null;
}

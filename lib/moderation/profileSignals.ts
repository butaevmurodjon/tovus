import type { User } from "grammy/types";
import { detectProfanity } from "./profanity";
import { SCAM_PROFILE_MARKERS } from "./spamDict";

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

  if (detectProfanity(parts).matched) {
    return "имя/юзернейм с нецензурной лексикой";
  }

  const lower = parts.toLowerCase();
  if (SCAM_PROFILE_MARKERS.some((marker) => lower.includes(marker))) {
    return "имя/юзернейм похоже на скам- или интим-предложение";
  }

  return null;
}

import type { User } from "grammy/types";
import { getGroupAdminIdentities, type AdminIdentity } from "@/lib/db/admins";
import { normalizeMessageText } from "./normalize";
import { similarity } from "./fuzzy";

// Below this length, similarity ratios are too easy to hit by chance ("Al"
// vs "Ali") to mean anything — skip the comparison entirely rather than flag
// noise.
const MIN_COMPARABLE_LENGTH = 3;
const SIMILARITY_THRESHOLD = 0.82;

/**
 * Pure comparison, separated from the Redis fetch so it's testable without a
 * live store: does `user`'s name or @username look like an impersonation of
 * any admin in `admins` (keyed by admin userId)?
 */
export function matchesAnyAdminIdentity(user: User, admins: Record<number, AdminIdentity>): boolean {
  const joinerName = normalizeMessageText([user.first_name, user.last_name].filter(Boolean).join(" "));
  const joinerUsername = user.username ? normalizeMessageText(user.username) : null;

  for (const [adminIdRaw, admin] of Object.entries(admins)) {
    if (Number(adminIdRaw) === user.id) continue;

    if (admin.name) {
      const adminName = normalizeMessageText(admin.name);
      if (
        joinerName.length >= MIN_COMPARABLE_LENGTH &&
        adminName.length >= MIN_COMPARABLE_LENGTH &&
        similarity(joinerName, adminName) >= SIMILARITY_THRESHOLD
      ) {
        return true;
      }
    }

    if (admin.username && joinerUsername) {
      const adminUsername = normalizeMessageText(admin.username);
      if (
        joinerUsername.length >= MIN_COMPARABLE_LENGTH &&
        adminUsername.length >= MIN_COMPARABLE_LENGTH &&
        similarity(joinerUsername, adminUsername) >= SIMILARITY_THRESHOLD
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * §15.2(a): a brand-new member whose display name or @username is
 * suspiciously close to an existing admin's is a common phishing/impersonation
 * setup ("fake support" DMs, fake "admin" announcements). This never bans —
 * homonyms and coincidentally-similar nicknames are common and the cost of a
 * false positive (forcing a captcha) is low, the cost of a false negative
 * (auto-banning a real member) is not. Reads from the cached admin-identity
 * hash only — no Telegram API call, so this stays cheap even during a raid.
 */
export async function isLikelyAdminImpersonation(chatId: number, user: User): Promise<boolean> {
  const admins = await getGroupAdminIdentities(chatId);
  if (Object.keys(admins).length === 0) return false;
  return matchesAnyAdminIdentity(user, admins);
}

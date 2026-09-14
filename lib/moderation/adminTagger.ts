/**
 * ROADMAP.md §7.2 item 5 — @LolsBot's "Тегер админов": a member writes
 * literal "@admin"/"@админ" (Telegram never resolves it to a real user —
 * no group has a member actually named "admin"), the bot pings the real
 * admins instead. Admin-convenience utility, not a safety feature — opt-in,
 * off by default (see GroupSettings.adminTaggerEnabled).
 */
const ADMIN_TAG_PATTERN = /(^|[^\p{L}\p{N}_])@(admin|админ)(?![\p{L}\p{N}_])/iu;

export function containsAdminTag(text: string): boolean {
  return ADMIN_TAG_PATTERN.test(text);
}

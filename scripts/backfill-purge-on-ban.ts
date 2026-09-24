/**
 * One-off migration: DEFAULT_GROUP_SETTINGS.purgeMessagesOnBan flipped to
 * `true` (lib/db/types.ts, 2026-09-24) so any ban also cleans up the banned
 * account's other recent messages, not just the one that triggered it — but
 * that default only reaches brand-new groups (see the resolution-order
 * comment on getGroupSettings in lib/db/groups.ts). Every group registered
 * before this shipped already has a FULL raw settings blob with the old
 * `false` baked in, since it was never a deliberate admin choice — just the
 * old registerGroup spreading DEFAULT_GROUP_SETTINGS wholesale — so it needs
 * a one-time nudge to `true` here. Run once: `npx tsx scripts/backfill-purge-on-ban.ts`.
 *
 * Safe to re-run: groups that already have it `true` (new groups, or an
 * admin who explicitly turned it on) are skipped, and this never touches a
 * group where an admin explicitly turned it back OFF via the punishments
 * settings page after this script's first run.
 */
import { getRedis } from "@/lib/db/redis";
import { listAllGroupIds } from "@/lib/db/groups";
import type { GroupSettings } from "@/lib/db/types";

async function main() {
  const redis = getRedis();
  const chatIds = await listAllGroupIds();
  let updated = 0;
  let skipped = 0;

  for (const chatId of chatIds) {
    const key = `group:${chatId}:settings`;
    const raw = await redis.get<Partial<GroupSettings> & { chatId: number }>(key);
    if (!raw) {
      skipped++;
      continue;
    }
    if (raw.purgeMessagesOnBan === true) {
      skipped++;
      continue;
    }
    await redis.set(key, { ...raw, purgeMessagesOnBan: true });
    updated++;
  }

  console.log(`Done. Updated ${updated} group(s), skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

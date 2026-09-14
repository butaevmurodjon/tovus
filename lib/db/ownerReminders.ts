import { getRedis } from "./redis";

/**
 * Bot-wide, owner-only sticky notes/toggles for "remember to do X later" —
 * NOT tied to any actual feature state. First use: a reminder to add
 * encryption-at-rest for the daily-summary buffer (lib/db/dailySummaryBuffer.ts)
 * if/when its retention window is ever extended past the current 48h TTL —
 * see PRIVACY.md and the 2026-09-14 conversation this came from. Flipping
 * this toggle does NOT itself encrypt anything; it's a checklist item for
 * the bot owner, visible only on the owner tools screen.
 */
const KEY = "owner:reminders";

export async function getOwnerReminders(): Promise<Record<string, boolean>> {
  const raw = await getRedis().hgetall<Record<string, boolean>>(KEY);
  return raw ?? {};
}

export async function setOwnerReminder(id: string, value: boolean): Promise<void> {
  await getRedis().hset(KEY, { [id]: value });
}

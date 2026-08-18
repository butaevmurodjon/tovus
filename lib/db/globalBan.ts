import { getRedis } from "./redis";
import type { GlobalBanEntry } from "./types";

// A single Hash (userId -> entry) rather than per-group storage: this ban is
// bot-owner scoped and applies everywhere, so there is exactly one list to
// check/maintain regardless of how many groups the bot is in.
const banHashKey = "bot:globalban";

export async function addGlobalBanEntry(entry: GlobalBanEntry): Promise<void> {
  await getRedis().hset(banHashKey, { [entry.userId]: entry });
}

export async function removeGlobalBanEntry(userId: number): Promise<void> {
  await getRedis().hdel(banHashKey, String(userId));
}

export async function isGloballyBanned(userId: number): Promise<boolean> {
  const entry = await getRedis().hget(banHashKey, String(userId));
  return entry != null;
}

export async function listGlobalBans(): Promise<GlobalBanEntry[]> {
  const all = await getRedis().hgetall<Record<string, GlobalBanEntry>>(banHashKey);
  if (!all) return [];
  return Object.values(all).sort((a, b) => b.bannedAt - a.bannedAt);
}

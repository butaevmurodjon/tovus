import { getRedis } from "./redis";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "./types";
import type { Lang } from "@/lib/i18n";
import { DEFAULT_LANG } from "@/lib/i18n";

const settingsKey = (chatId: number) => `group:${chatId}:settings`;
const whitelistKey = (chatId: number) => `group:${chatId}:whitelist`;
const allGroupsKey = "bot:groups";

export async function registerGroup(chatId: number, title: string, lang?: Lang): Promise<void> {
  const redis = getRedis();
  await redis.sadd(allGroupsKey, chatId);
  const current = await getGroupSettings(chatId);
  if (!current) {
    const settings: GroupSettings = {
      chatId,
      title,
      ...DEFAULT_GROUP_SETTINGS,
      lang: lang ?? DEFAULT_LANG,
      createdAt: Date.now(),
    };
    await redis.set(settingsKey(chatId), settings);
  } else if (current.title !== title) {
    await saveGroupSettings({ ...current, title });
  }
}

export async function unregisterGroup(chatId: number): Promise<void> {
  await getRedis().srem(allGroupsKey, chatId);
}

export async function listAllGroupIds(): Promise<number[]> {
  const ids = await getRedis().smembers<string[]>(allGroupsKey);
  return (ids ?? []).map((id) => Number(id));
}

export async function getGroupSettings(chatId: number): Promise<GroupSettings | null> {
  const data = await getRedis().get<GroupSettings>(settingsKey(chatId));
  return data ?? null;
}

export async function saveGroupSettings(settings: GroupSettings): Promise<void> {
  await getRedis().set(settingsKey(settings.chatId), settings);
}

export async function updateGroupSettings(
  chatId: number,
  patch: Partial<Omit<GroupSettings, "chatId">>
): Promise<GroupSettings | null> {
  const current = await getGroupSettings(chatId);
  if (!current) return null;
  const next: GroupSettings = { ...current, ...patch };
  await saveGroupSettings(next);
  return next;
}

// --- Whitelist ---

export async function getWhitelist(chatId: number): Promise<number[]> {
  const ids = await getRedis().smembers<string[]>(whitelistKey(chatId));
  return (ids ?? []).map(Number);
}

export async function isWhitelisted(chatId: number, userId: number): Promise<boolean> {
  const result = await getRedis().sismember(whitelistKey(chatId), userId);
  return result === 1;
}

export async function addToWhitelist(chatId: number, userId: number): Promise<void> {
  await getRedis().sadd(whitelistKey(chatId), userId);
}

export async function removeFromWhitelist(chatId: number, userId: number): Promise<void> {
  await getRedis().srem(whitelistKey(chatId), userId);
}

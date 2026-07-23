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
  } else {
    // A group registered before a schema change is missing whatever fields were
    // added since — merge those defaults in so older groups don't silently fall
    // back to `undefined` for new features instead of the intended default.
    const backfill: Partial<GroupSettings> = {};
    for (const k of Object.keys(DEFAULT_GROUP_SETTINGS) as (keyof typeof DEFAULT_GROUP_SETTINGS)[]) {
      if (!(k in current)) (backfill as Record<string, unknown>)[k] = DEFAULT_GROUP_SETTINGS[k];
    }
    if (current.title !== title || Object.keys(backfill).length > 0) {
      await saveGroupSettings({ ...current, ...backfill, title });
    }
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

type SettingsPatch = Partial<Omit<GroupSettings, "chatId">>;

/** Explicitly turning the manual antiraid toggle off must mean fully off —
 * `antiraidAuto` defaults true, so without this cascade a group that once
 * enabled and then disabled antiraid would silently stay protected via the
 * automatic fallback, contradicting what the toggle shows. Exported for
 * testing; not meant to be called directly outside updateGroupSettings. */
export function applyAntiraidCascade(patch: SettingsPatch): SettingsPatch {
  return patch.antiraidEnabled === false ? { ...patch, antiraidAuto: false } : patch;
}

/** Explicitly setting the warn limit to 0 must mean escalation is fully off —
 * otherwise a stale `warnEscalationEnabled: true` from before would keep
 * comparing warn counts against a limit of 0, escalating on the very first
 * warn. Exported for testing; not meant to be called directly outside
 * updateGroupSettings. */
export function applyWarnLimitCascade(patch: SettingsPatch): SettingsPatch {
  return patch.warnLimit === 0 ? { ...patch, warnEscalationEnabled: false } : patch;
}

export async function updateGroupSettings(chatId: number, patch: SettingsPatch): Promise<GroupSettings | null> {
  const current = await getGroupSettings(chatId);
  if (!current) return null;
  const cascaded = applyWarnLimitCascade(applyAntiraidCascade(patch));
  const next: GroupSettings = { ...current, ...cascaded };
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

export async function clearWhitelist(chatId: number): Promise<void> {
  await getRedis().del(whitelistKey(chatId));
}

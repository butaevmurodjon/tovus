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

/** True only while the bot is registered as present in this chat.  This is
 * intentionally separate from settings existence: settings are retained after
 * the bot leaves so they can be restored if it is added back later. */
export async function isRegisteredGroup(chatId: number): Promise<boolean> {
  return (await getRedis().sismember(allGroupsKey, chatId)) === 1;
}

export async function getGroupSettings(chatId: number): Promise<GroupSettings | null> {
  const data = await getRedis().get<GroupSettings>(settingsKey(chatId));
  if (!data) return null;
  // Groups registered before a schema change may be missing fields added since,
  // and won't get backfilled until their next my_chat_member event (see
  // registerGroup) — merge in defaults on every read so callers never see
  // `undefined` for a setting that looks "on" in the UI (e.g. warnTtlDays
  // turning into NaN math downstream).
  return { ...DEFAULT_GROUP_SETTINGS, ...data };
}

export async function saveGroupSettings(settings: GroupSettings): Promise<void> {
  await getRedis().set(settingsKey(settings.chatId), settings);
}

type SettingsPatch = Partial<Omit<GroupSettings, "chatId">>;

type Cascade = (current: GroupSettings, patch: SettingsPatch) => SettingsPatch;

/** Explicitly turning the manual antiraid toggle off must mean fully off —
 * `antiraidAuto` defaults true, so without this cascade a group that once
 * enabled and then disabled antiraid would silently stay protected via the
 * automatic fallback, contradicting what the toggle shows. Exported for
 * testing; not meant to be called directly outside updateGroupSettings. */
export const applyAntiraidCascade: Cascade = (_current, patch) => {
  return patch.antiraidEnabled === false ? { ...patch, antiraidAuto: false } : patch;
};

/** Explicitly setting the warn limit to 0 must mean escalation is fully off —
 * otherwise a stale `warnEscalationEnabled: true` from before would keep
 * comparing warn counts against a limit of 0, escalating on the very first
 * warn. Checks the *effective* limit (patch value, falling back to what's
 * already stored) so re-enabling the toggle alone — without also resending
 * the limit — can't resurrect an escalation that was previously killed via a
 * `warnLimit: 0` patch. Exported for testing; not meant to be called directly
 * outside updateGroupSettings. */
export const applyWarnLimitCascade: Cascade = (current, patch) => {
  const effectiveLimit = patch.warnLimit ?? current.warnLimit;
  return effectiveLimit === 0 ? { ...patch, warnEscalationEnabled: false } : patch;
};

// New cascades just get added here — nothing else has to remember to nest
// another call, so one can't be forgotten wiring it into updateGroupSettings.
const CASCADES: Cascade[] = [applyAntiraidCascade, applyWarnLimitCascade];

export async function updateGroupSettings(chatId: number, patch: SettingsPatch): Promise<GroupSettings | null> {
  const current = await getGroupSettings(chatId);
  if (!current) return null;
  const cascaded = CASCADES.reduce((p, cascade) => cascade(current, p), patch);
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

import { getRedis } from "./redis";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "./types";
import type { Lang } from "@/lib/i18n";
import { DEFAULT_LANG } from "@/lib/i18n";
import { getPolicy, type PolicyKey } from "./policy";

const settingsKey = (chatId: number) => `group:${chatId}:settings`;
const whitelistKey = (chatId: number) => `group:${chatId}:whitelist`;
const allGroupsKey = "bot:groups";

type RawGroupSettings = Partial<GroupSettings> & { chatId: number };

/** Sparse, exactly what's in Redis — no defaults or policy merged in.
 * Internal only: every external caller wants the resolved getGroupSettings
 * below. Only updateGroupSettings and clearGroupOverrides read this
 * directly, because they need to know which fields this group has actually
 * touched, as opposed to which fields merely resolve to something right now. */
async function getRawGroupSettings(chatId: number): Promise<RawGroupSettings | null> {
  return getRedis().get<RawGroupSettings>(settingsKey(chatId));
}

async function saveRawGroupSettings(raw: RawGroupSettings): Promise<void> {
  await getRedis().set(settingsKey(raw.chatId), raw);
}

export async function registerGroup(chatId: number, title: string, lang?: Lang): Promise<void> {
  const redis = getRedis();
  await redis.sadd(allGroupsKey, chatId);
  const current = await getRawGroupSettings(chatId);
  if (!current) {
    // Sparse on purpose (FAANG-audit §5, bot-wide default policy — see
    // lib/db/policy.ts) — NOT spread with DEFAULT_GROUP_SETTINGS the way
    // this used to work. A brand-new group now inherits the policy (and,
    // for anything policy doesn't set, the hardcoded default) for every
    // field it never explicitly touches. getGroupSettings below resolves
    // the gaps on every read, so there is no correctness gap from leaving
    // them out of storage — only new groups get to benefit from policy at
    // all, which is the point.
    const settings: RawGroupSettings = {
      chatId,
      title,
      lang: lang ?? DEFAULT_LANG,
      createdAt: Date.now(),
    };
    await redis.set(settingsKey(chatId), settings);
  } else if (current.title !== title) {
    // Telegram's own chat title changed — the one thing here that's
    // genuinely per-group data, always written regardless of policy.
    await saveRawGroupSettings({ ...current, title });
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

/**
 * Resolution order, low → high precedence: hardcoded DEFAULT_GROUP_SETTINGS
 * < bot-wide policy (lib/db/policy.ts) < this group's own stored fields.
 * A field only ever lands in the group's raw storage when an admin/owner
 * actually changed it — never at registration any more (see registerGroup)
 * — so policy genuinely reaches brand-new groups.
 *
 * Every group registered before this shipped already has a FULL raw blob
 * (the old registerGroup used to spread DEFAULT_GROUP_SETTINGS into every
 * new group) — for them every field already counts as "explicitly touched",
 * so policy has zero effect on any group moderating live traffic today,
 * until an owner explicitly opts one in via clearGroupOverrides. That's
 * intentional, not a migration gap: shipping this must not silently change
 * how any existing group is moderated.
 */
export async function getGroupSettings(chatId: number): Promise<GroupSettings | null> {
  const raw = await getRawGroupSettings(chatId);
  if (!raw) return null;
  const policy = await getPolicy();
  return { ...DEFAULT_GROUP_SETTINGS, ...policy, ...raw } as GroupSettings;
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
  const raw = await getRawGroupSettings(chatId);
  if (!raw) return null;
  const policy = await getPolicy();
  // Resolved view is only for the cascades' own decision-making (e.g. "what
  // is the EFFECTIVE warn limit right now, including anything inherited
  // from policy") — it is never what gets persisted below. What gets
  // persisted is the existing raw blob plus the patch, still sparse, so
  // changing one field can never freeze the other ~40 against future policy
  // changes the way saving a fully-resolved object back would.
  const resolvedCurrent = { ...DEFAULT_GROUP_SETTINGS, ...policy, ...raw } as GroupSettings;
  const cascaded = CASCADES.reduce((p, cascade) => cascade(resolvedCurrent, p), patch);
  const nextRaw: RawGroupSettings = { ...raw, ...cascaded };
  await saveRawGroupSettings(nextRaw);
  return { ...DEFAULT_GROUP_SETTINGS, ...policy, ...nextRaw } as GroupSettings;
}

/**
 * Owner action: drop this group's own stored values for the given
 * policy-eligible fields, so each one falls through to the bot-wide policy
 * (or the hardcoded default, for anything policy doesn't set) on the very
 * next read. This is the ONLY way an already-registered group — which
 * stores a full raw blob, see registerGroup's comment — can adopt policy
 * for fields it already has an explicit value for; nothing else clears a
 * field back out of storage.
 */
export async function clearGroupOverrides(chatId: number, keys: PolicyKey[]): Promise<GroupSettings | null> {
  const raw = await getRawGroupSettings(chatId);
  if (!raw) return null;
  const nextRaw = { ...raw };
  for (const key of keys) delete (nextRaw as Record<string, unknown>)[key];
  await saveRawGroupSettings(nextRaw);
  const policy = await getPolicy();
  return { ...DEFAULT_GROUP_SETTINGS, ...policy, ...nextRaw } as GroupSettings;
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

import { getRedis } from "./redis";
import { getGroupSettings } from "./groups";

// Append-only, capped, owner-scoped record of every God Mode action, so a
// destructive bot-wide action always leaves a trace of who did what and when
// (ROADMAP §6.3/§6.4). Same pipelined lpush+ltrim+expire shape as
// shadowStats.ts's divergence buffer.
const KEY = "owner:audit";
const MAX_ENTRIES = 500;
const TTL_SECONDS = 60 * 60 * 24 * 180; // 180d — long enough to be a real record, still bounded

export type OwnerAuditAction =
  | "globalban"
  | "globalunban"
  | "airule_add"
  | "airule_remove"
  | "broadcast"
  | "group_ban"
  | "group_delete"
  | "group_resetrep";

export interface OwnerAuditEntry {
  id: string;
  ts: number;
  /** Telegram id of whoever performed it. Always BOT_OWNER_ID today; kept per
   * entry so a future operators table (ROADMAP §6.3) needs no migration. */
  actorId: number;
  action: OwnerAuditAction;
  /** Human-readable target: "user 123", "msg 45 · Title (-100…)". */
  target: string;
  /** The salient parameter — ban reason, rule text, broadcast body. Capped. */
  detail?: string;
  /** Outcome summary — "12/40 групп", "ошибка". */
  outcome?: string;
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Best-effort: swallows its own errors so a failed audit write can never
 * abort or fail the God Mode action it records. */
export async function recordOwnerAudit(entry: Omit<OwnerAuditEntry, "id" | "ts">): Promise<void> {
  try {
    const row: OwnerAuditEntry = {
      ...entry,
      detail: entry.detail?.slice(0, 300),
      outcome: entry.outcome?.slice(0, 120),
      id: randomId(),
      ts: Date.now(),
    };
    const pipeline = getRedis().pipeline();
    pipeline.lpush(KEY, row);
    pipeline.ltrim(KEY, 0, MAX_ENTRIES - 1);
    pipeline.expire(KEY, TTL_SECONDS);
    await pipeline.exec();
  } catch {
    // audit is a nice-to-have record, never a gate
  }
}

export async function listOwnerAudit(limit = 100): Promise<OwnerAuditEntry[]> {
  const raw = await getRedis().lrange<OwnerAuditEntry>(KEY, 0, Math.max(1, limit) - 1);
  return raw ?? [];
}

/** "Title (-100…)" when known, else "группа -100…" — for an audit entry's target. */
export async function groupAuditLabel(chatId: number): Promise<string> {
  const settings = await getGroupSettings(chatId).catch(() => null);
  return settings?.title ? `${settings.title} (${chatId})` : `группа ${chatId}`;
}

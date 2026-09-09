import { getRedis } from "./redis";

// Append-only, capped log of bot-added / bot-removed events, so the owner
// overview can show real churn (ROADMAP §6.3 "отток = бот удалён"). Before
// this, unregisterGroup was a bare SREM and churn history was unrecoverable —
// so the "−groups" figure is honestly empty until events accrue from here on,
// never a misleading 0. Same pipelined lpush+ltrim+expire shape as auditLog.ts.
const KEY = "bot:groupevents";
const MAX_ENTRIES = 1000;
const TTL_SECONDS = 60 * 60 * 24 * 120; // 120d — covers the 7d/30d windows with margin

export interface GroupEvent {
  ts: number;
  type: "added" | "removed";
  chatId: number;
  title: string;
}

/** Best-effort: swallows its own errors so a failed write never blocks the
 * my_chat_member handler. */
export async function recordGroupEvent(type: GroupEvent["type"], chatId: number, title: string): Promise<void> {
  try {
    const row: GroupEvent = { ts: Date.now(), type, chatId, title: title.slice(0, 120) };
    const pipeline = getRedis().pipeline();
    pipeline.lpush(KEY, row);
    pipeline.ltrim(KEY, 0, MAX_ENTRIES - 1);
    pipeline.expire(KEY, TTL_SECONDS);
    await pipeline.exec();
  } catch {
    // churn history is a nice-to-have, never a gate
  }
}

/** All recorded events newer than `sinceMs`, newest first. */
export async function getGroupEvents(sinceMs: number): Promise<GroupEvent[]> {
  const raw = (await getRedis().lrange<GroupEvent>(KEY, 0, MAX_ENTRIES - 1)) ?? [];
  return raw.filter((e) => e && e.ts >= sinceMs);
}

/** True once at least one event has ever been recorded — lets the UI tell
 * "no churn" (show 0) apart from "no data yet" (show «нет данных»). */
export async function hasGroupEvents(): Promise<boolean> {
  return ((await getRedis().llen(KEY)) ?? 0) > 0;
}

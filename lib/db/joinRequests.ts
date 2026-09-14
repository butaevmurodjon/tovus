import { getRedis } from "./redis";

/**
 * ROADMAP.md §7.3 "Массовое принятие/отклонение заявок на вступление" —
 * @LolsBot's own docs describe this as needed specifically when a group's
 * manual-approval queue has "накопилось большое количество не принятых
 * заявок". The Bot API has no "list pending join requests" call, so this
 * only ever sees requests the bot's own `chat_join_request` handler already
 * observed live (bot.ts) — same structural limit as messageAuthors.ts's
 * caches. Only recorded when the request WASN'T already auto-resolved by
 * globalban/CAS/joinRequestCaptcha (bot.ts skips recording in those cases —
 * this list is for the genuinely-still-pending, human-review population).
 *
 * Same hash + sorted-set shape as appeals.ts/journal.ts: id-addressed
 * lookup (here, Telegram user id) that survives concurrent inserts, plus
 * cheap recency ordering for the Mini App list.
 */
export interface PendingJoinRequest {
  userId: number;
  displayName: string;
  username: string | null;
  requestedAt: number;
}

const entriesKey = (chatId: number) => `group:${chatId}:joinrequests:entries`;
const orderKey = (chatId: number) => `group:${chatId}:joinrequests:order`;
// Telegram lets a join request sit pending indefinitely — this caps how long
// WE keep tracking it as "known pending" so an abandoned group's queue can't
// grow forever. A request older than this just stops showing up in the
// bulk-review list; it's still pending on Telegram's side either way.
const MAX_ENTRIES = 300;

export async function addPendingJoinRequest(chatId: number, entry: PendingJoinRequest): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.hset(entriesKey(chatId), { [entry.userId]: entry }),
    redis.zadd(orderKey(chatId), { score: entry.requestedAt, member: entry.userId }),
  ]);

  const total = await redis.zcard(orderKey(chatId));
  if (total > MAX_ENTRIES) {
    const staleIds = await redis.zrange<string[]>(orderKey(chatId), 0, total - MAX_ENTRIES - 1);
    if (staleIds.length > 0) {
      await Promise.all([redis.zrem(orderKey(chatId), ...staleIds), redis.hdel(entriesKey(chatId), ...staleIds)]);
    }
  }
}

/** Removes a request from the pending list — called both when we resolve it
 * ourselves (bulk approve/decline) and when bot.ts's `chat_member` handler
 * observes the user actually became a member (approved through Telegram's
 * own native UI, not ours). There's no equivalent signal for a native-UI
 * decline — Telegram just silently drops the request with no update at
 * all — so a manually-declined request lingers here until MAX_ENTRIES/TTL
 * eviction; harmless (bulk-approving it again is a no-op on Telegram's side
 * since the user is no longer pending). */
export async function removePendingJoinRequest(chatId: number, userId: number): Promise<void> {
  const redis = getRedis();
  await Promise.all([redis.hdel(entriesKey(chatId), String(userId)), redis.zrem(orderKey(chatId), userId)]);
}

export async function listPendingJoinRequests(chatId: number): Promise<PendingJoinRequest[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(orderKey(chatId), 0, -1, { rev: true });
  if (ids.length === 0) return [];
  const entries = await redis.hmget<Record<string, PendingJoinRequest>>(entriesKey(chatId), ...ids);
  if (!entries) return [];
  return ids.map((id) => entries[id]).filter((entry): entry is PendingJoinRequest => entry != null);
}

export async function countPendingJoinRequests(chatId: number): Promise<number> {
  return await getRedis().zcard(orderKey(chatId));
}

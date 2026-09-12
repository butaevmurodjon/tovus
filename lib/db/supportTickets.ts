import { getRedis } from "./redis";
import type { SupportTicket } from "./types";

// Same hash + sorted-set shape as appeals.ts/journal.ts, for the same reason:
// id-addressed lookup/update that survives concurrent inserts, plus cheap
// recency ordering. Unlike appeals.ts (scoped per group), tickets are a
// single bot-wide list — there's only one bot owner reading them.
const entriesKey = () => "support:tickets:entries";
const orderKey = () => "support:tickets:order";
const MAX_ENTRIES = 500;

// No TTL on entries themselves (see the SupportTicket doc comment — an owner
// must be able to reply days later), but the index below intentionally DOES
// still let old, off-radar mappings just sit there; they cost one small hash
// field each and are only ever read by a direct chatId+messageId lookup, so
// there's no reason to prune it on a schedule.
const replyIndexKey = (ownerChatId: number) => `support:tickets:byMessage:${ownerChatId}`;

export async function addSupportTicket(entry: SupportTicket): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.hset(entriesKey(), { [entry.id]: entry }),
    redis.zadd(orderKey(), { score: entry.createdAt, member: entry.id }),
    redis.hset(replyIndexKey(entry.ownerChatId), { [entry.ownerMessageId]: entry.id }),
  ]);

  const total = await redis.zcard(orderKey());
  if (total > MAX_ENTRIES) {
    const staleIds = await redis.zrange<string[]>(orderKey(), 0, total - MAX_ENTRIES - 1);
    if (staleIds.length > 0) {
      await Promise.all([redis.zrem(orderKey(), ...staleIds), redis.hdel(entriesKey(), ...staleIds)]);
    }
  }
}

export async function listSupportTickets(limit = 50): Promise<SupportTicket[]> {
  const redis = getRedis();
  const ids = await redis.zrange<string[]>(orderKey(), 0, limit - 1, { rev: true });
  if (ids.length === 0) return [];
  const entries = await redis.hmget<Record<string, SupportTicket>>(entriesKey(), ...ids);
  if (!entries) return [];
  return ids.map((id) => entries[id]).filter((entry): entry is SupportTicket => entry != null);
}

export async function findSupportTicket(id: string): Promise<SupportTicket | null> {
  const redis = getRedis();
  const entry = await redis.hget<SupportTicket>(entriesKey(), id);
  return entry ?? null;
}

/** Resolves "which ticket is this owner reply about", from the message id
 * the owner replied to (Telegram's `reply_to_message.message_id` in their DM
 * with the bot). Durable — no TTL — since a reply can land any time after
 * the ticket was relayed. */
export async function findSupportTicketByOwnerMessage(
  ownerChatId: number,
  ownerMessageId: number
): Promise<SupportTicket | null> {
  const redis = getRedis();
  const id = await redis.hget<string>(replyIndexKey(ownerChatId), String(ownerMessageId));
  if (!id) return null;
  return findSupportTicket(id);
}

export async function setSupportTicketStatus(id: string, status: SupportTicket["status"]): Promise<SupportTicket | null> {
  const redis = getRedis();
  const entry = await redis.hget<SupportTicket>(entriesKey(), id);
  if (!entry) return null;
  const updated: SupportTicket = { ...entry, status };
  await redis.hset(entriesKey(), { [id]: updated });
  return updated;
}

// --- per-(group-admin) cooldown, so one admin can't flood the owner's inbox ---
// Same shape as appeals.ts's tryStartAppealCooldown, scoped per user (not per
// group) since one admin could manage several groups and open a ticket "for"
// each — the abuse surface here is the PERSON messaging repeatedly, not which
// group they claim it's about.

const cooldownKey = (userId: number) => `support:cooldown:${userId}`;
const COOLDOWN_SECONDS = 24 * 60 * 60;

export async function isSupportOnCooldown(userId: number): Promise<boolean> {
  return (await getRedis().exists(cooldownKey(userId))) === 1;
}

/** Atomically claims the cooldown — SET NX, same pattern as
 * tryStartAppealCooldown. Returns true only for the caller that actually won
 * the claim. */
export async function tryStartSupportCooldown(userId: number): Promise<boolean> {
  try {
    const res = await getRedis().set(cooldownKey(userId), 1, { nx: true, ex: COOLDOWN_SECONDS });
    return res === "OK";
  } catch {
    // Fail closed: an unreadable claim must not look like "not on cooldown".
    return false;
  }
}

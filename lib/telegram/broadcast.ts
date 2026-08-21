import type { Api } from "grammy";
import { listAllGroupIds } from "@/lib/db/groups";
import { getRedis } from "@/lib/db/redis";

// Telegram throttles bulk sendMessage calls to different chats at roughly
// ~30/sec bot-wide. A small batch + pause keeps a broadcast to many groups
// well under that instead of firing everything in one Promise.all and having
// the tail end of the list get silently rate-limited.
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
}

async function sendToChats(api: Api, chatIds: number[], text: string): Promise<BroadcastResult> {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < chatIds.length; i += BATCH_SIZE) {
    const batch = chatIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((chatId) =>
        api
          .sendMessage(chatId, text)
          .then(() => true)
          .catch(() => false)
      )
    );
    sent += results.filter(Boolean).length;
    failed += results.filter((ok) => !ok).length;
    if (i + BATCH_SIZE < chatIds.length) await sleep(BATCH_DELAY_MS);
  }

  return { total: chatIds.length, sent, failed };
}

/** Sends `text` as a plain message to every group the bot currently manages. */
export async function broadcastToAllGroups(api: Api, text: string): Promise<BroadcastResult> {
  return sendToChats(api, await listAllGroupIds(), text);
}

/** Sends `text` to exactly the given chats — the M4 cross-group admin
 * broadcast (§15.5), which targets only federation.ts's computed audience,
 * not every group the bot manages. */
export async function broadcastToChats(api: Api, chatIds: number[], text: string): Promise<BroadcastResult> {
  return sendToChats(api, chatIds, text);
}

const ADMIN_BROADCAST_DAILY_LIMIT = 3;
const adminBroadcastCountKey = (chatId: number) => `broadcast:admin:${chatId}:count`;

/**
 * §15.5's abuse guard: at most ADMIN_BROADCAST_DAILY_LIMIT sends per day per
 * SOURCE group (the group the admin triggered the broadcast from), not per
 * admin globally — an admin of several groups gets one quota per group.
 * Returns false (and consumes nothing further) once the limit is hit.
 */
export async function consumeAdminBroadcastQuota(chatId: number): Promise<boolean> {
  const redis = getRedis();
  const key = adminBroadcastCountKey(chatId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60 * 60 * 24);
  return count <= ADMIN_BROADCAST_DAILY_LIMIT;
}

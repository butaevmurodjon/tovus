import type { Api } from "grammy";
import { listAllGroupIds } from "@/lib/db/groups";

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

/** Sends `text` as a plain message to every group the bot currently manages. */
export async function broadcastToAllGroups(api: Api, text: string): Promise<BroadcastResult> {
  const chatIds = await listAllGroupIds();
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

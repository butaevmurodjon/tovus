import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { getRedis } from "./redis";

const CACHE_TTL_SECONDS = 60 * 60; // group size doesn't change fast enough to need live lookups every time
const key = (chatId: number) => `group:${chatId}:membercount`;

/** Redis-cached so plan-gating checks (captcha/antiraid toggles, Mini App display) don't hit getChatMemberCount every time. */
export async function getCachedMemberCount(api: Api, chatId: number): Promise<number | null> {
  const redis = getRedis();
  const cached = await redis.get<number>(key(chatId));
  if (cached !== null) return cached;

  try {
    const count = await api.getChatMemberCount(chatId);
    await redis.set(key(chatId), count, { ex: CACHE_TTL_SECONDS });
    return count;
  } catch (err) {
    if (err instanceof GrammyError) return null;
    throw err;
  }
}

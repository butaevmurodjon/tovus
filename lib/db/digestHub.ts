import type { Api } from "grammy";
import { getRedis } from "./redis";

/**
 * ROADMAP.md §7.3 daily AI summary, 2026-09-14 re-cut: digests no longer
 * post into the source group itself — they go to a single hub supergroup
 * the bot owner controls (`DIGEST_HUB_CHAT_ID` env var, unset = feature
 * fully inert), one Telegram Forum **topic per source group**, named after
 * that group's title. This maps each monitored chatId to the
 * `message_thread_id` Telegram assigned its topic, creating one on first
 * use.
 *
 * The hub chat must be a supergroup with Topics (forum mode) turned on, and
 * the bot must be an admin there with "Manage Topics" rights — same
 * precondition `createForumTopic` itself requires.
 */
const TOPIC_MAP_KEY = "digesthub:topics"; // hash: chatId -> message_thread_id
const TOPIC_NAME_MAX_LENGTH = 128; // Bot API's own cap on a topic's name

export async function getHubTopicId(chatId: number): Promise<number | null> {
  const value = await getRedis().hget<number>(TOPIC_MAP_KEY, String(chatId));
  return value ?? null;
}

/**
 * Returns the existing topic id for this group, or creates one. Returns
 * null only if topic creation itself failed (hub misconfigured, bot isn't
 * an admin there, hub isn't a forum, etc.) — callers treat that as "skip
 * this group this run", never as a reason to fall back to the group's own
 * chat (that fallback was the OLD behavior this re-cut deliberately drops).
 */
export async function getOrCreateHubTopic(api: Api, hubChatId: number, chatId: number, title: string): Promise<number | null> {
  const existing = await getHubTopicId(chatId);
  if (existing !== null) return existing;

  const topicName = (title || String(chatId)).slice(0, TOPIC_NAME_MAX_LENGTH);
  const topic = await api.createForumTopic(hubChatId, topicName).catch(() => null);
  if (!topic) return null;

  await getRedis().hset(TOPIC_MAP_KEY, { [String(chatId)]: topic.message_thread_id });
  return topic.message_thread_id;
}

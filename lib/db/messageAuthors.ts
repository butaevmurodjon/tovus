import { getRedis } from "./redis";

// 30 days: long enough to cover "who posted this" lookups for a link pasted
// well after the fact, short enough that this never becomes an unbounded
// message archive — same horizon as reputation.ts and captcha state.
const TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_CACHED_TEXT_LENGTH = 500;

const lastMessageKey = (chatId: number, userId: number) => `lastmsg:${chatId}:${userId}`;
const authorKey = (chatId: number, messageId: number) => `msgauthor:${chatId}:${messageId}`;
// Global, not per-chat: Telegram usernames are unique bot-wide, and the
// God Mode "@username -> ban" tool needs to resolve one without knowing
// which group the user is in. getChat("@username") only reliably resolves
// chats/users the bot already has a relationship with — an arbitrary
// group member with no prior DM to the bot often 400s — so this index,
// built from messages the bot has actually seen, is the primary path;
// getChat is only a fallback (see app/api/miniapp/owner/resolve/route.ts).
const usernameKey = (username: string) => `uname:${username.toLowerCase()}`;

export interface CachedMessage {
  userId: number;
  text: string;
}

/** Called once per incoming message (bot.ts) so later owner actions — ban
 * cleanup, message-link resolution, "teach the AI from this message" — can
 * work from just a chatId/messageId/userId without the bot needing to
 * re-fetch anything from Telegram (the Bot API has no "get message by id"). */
export async function recordMessage(
  chatId: number,
  userId: number,
  messageId: number,
  text: string,
  username?: string | null
): Promise<void> {
  const cached: CachedMessage = { userId, text: text.slice(0, MAX_CACHED_TEXT_LENGTH) };
  // Pipelined into one Upstash REST round trip instead of 2-3 concurrent
  // calls — this runs on every non-edit message in every moderated group,
  // the hottest path in the codebase.
  const pipeline = getRedis().pipeline();
  pipeline.set(lastMessageKey(chatId, userId), messageId, { ex: TTL_SECONDS });
  pipeline.set(authorKey(chatId, messageId), cached, { ex: TTL_SECONDS });
  if (username) pipeline.set(usernameKey(username), userId, { ex: TTL_SECONDS });
  await pipeline.exec();
}

/** Best-effort — null if this username was never seen by the bot (or its
 * 30-day cache expired), in which case callers fall back to getChat. */
export async function resolveUsername(username: string): Promise<number | null> {
  const clean = username.replace(/^@/, "");
  return (await getRedis().get<number>(usernameKey(clean))) ?? null;
}

export async function getLastMessageId(chatId: number, userId: number): Promise<number | null> {
  return (await getRedis().get<number>(lastMessageKey(chatId, userId))) ?? null;
}

export async function clearLastMessage(chatId: number, userId: number): Promise<void> {
  await getRedis().del(lastMessageKey(chatId, userId));
}

/** Null when the message predates the cache TTL or was never seen live by the bot. */
export async function getCachedMessage(chatId: number, messageId: number): Promise<CachedMessage | null> {
  return (await getRedis().get<CachedMessage>(authorKey(chatId, messageId))) ?? null;
}

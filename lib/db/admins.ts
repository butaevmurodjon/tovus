import type { Api } from "grammy";
import { getRedis } from "./redis";

// Reverse index (userId -> chatIds they administer) so the Mini App dashboard
// doesn't have to scan every group the bot is in and call getChatMember on
// each one just to find out which handful belong to the requesting user —
// that scales as O(all groups the bot has ever joined), not O(this user's
// groups), and grinds into Telegram's rate limit as the bot's group count
// grows. Kept in sync by chat_member updates (see bot.ts) plus a full resync
// whenever the bot itself joins/gets promoted, since we have no history of
// who was already admin before that point.
const groupAdminsKey = (chatId: number) => `group:${chatId}:admins`;
const userAdminGroupsKey = (userId: number) => `user:${userId}:adminGroups`;

/** Full resync from Telegram — the only way to learn the current admin list
 * without having observed every past chat_member change. */
export async function syncGroupAdmins(api: Api, chatId: number): Promise<void> {
  const redis = getRedis();
  const admins = await api.getChatAdministrators(chatId).catch(() => null);
  if (!admins) return;

  const nextIds = new Set(admins.filter((m) => !m.user.is_bot).map((m) => m.user.id));
  const previousIds = new Set(
    ((await redis.smembers<string[]>(groupAdminsKey(chatId))) ?? []).map(Number)
  );

  const removed = [...previousIds].filter((id) => !nextIds.has(id));
  const added = [...nextIds].filter((id) => !previousIds.has(id));

  const tasks: Promise<unknown>[] = [
    ...removed.map((id) => redis.srem(userAdminGroupsKey(id), chatId)),
    ...added.map((id) => redis.sadd(userAdminGroupsKey(id), chatId)),
  ];
  // redis.sadd/srem require a tuple for the spread (a plain number[] doesn't
  // satisfy that), so destructure the first element out explicitly.
  if (removed.length > 0) {
    const [first, ...rest] = removed;
    tasks.push(redis.srem(groupAdminsKey(chatId), first, ...rest));
  }
  if (added.length > 0) {
    const [first, ...rest] = added;
    tasks.push(redis.sadd(groupAdminsKey(chatId), first, ...rest));
  }
  await Promise.all(tasks);
}

/** Incremental update for a single user's admin status change — far cheaper
 * than a full resync, used from the chat_member update handler. */
export async function setUserAdminStatus(chatId: number, userId: number, isAdmin: boolean): Promise<void> {
  const redis = getRedis();
  if (isAdmin) {
    await Promise.all([redis.sadd(groupAdminsKey(chatId), userId), redis.sadd(userAdminGroupsKey(userId), chatId)]);
  } else {
    await Promise.all([redis.srem(groupAdminsKey(chatId), userId), redis.srem(userAdminGroupsKey(userId), chatId)]);
  }
}

export async function getUserAdminGroupIds(userId: number): Promise<number[]> {
  const ids = await getRedis().smembers<string[]>(userAdminGroupsKey(userId));
  return (ids ?? []).map(Number);
}

/** Called when the bot leaves/is removed — drops this chat out of every
 * admin's reverse index so it doesn't dangle forever pointing at a group the
 * bot can no longer even look up. */
export async function clearGroupAdmins(chatId: number): Promise<void> {
  const redis = getRedis();
  const adminIds = (await redis.smembers<string[]>(groupAdminsKey(chatId))) ?? [];
  await Promise.all([
    ...adminIds.map((id) => redis.srem(userAdminGroupsKey(Number(id)), chatId)),
    redis.del(groupAdminsKey(chatId)),
  ]);
}

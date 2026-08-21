import type { Api } from "grammy";
import type { User } from "grammy/types";
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
// Display identities (name/username) for the same admins — kept separate from
// the ID-only set above since most readers (federation, Mini App) never need
// names, and this hash is used only by the join-time impersonation check.
const groupAdminNamesKey = (chatId: number) => `group:${chatId}:adminNames`;

export interface AdminIdentity {
  name: string;
  username: string | null;
}

export function identityOf(user: Pick<User, "first_name" | "last_name" | "username">): AdminIdentity {
  return {
    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    username: user.username ?? null,
  };
}

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
    tasks.push(redis.hdel(groupAdminNamesKey(chatId), String(first), ...rest.map(String)));
  }
  if (added.length > 0) {
    const [first, ...rest] = added;
    tasks.push(redis.sadd(groupAdminsKey(chatId), first, ...rest));
  }
  for (const admin of admins) {
    if (!nextIds.has(admin.user.id)) continue;
    tasks.push(redis.hset(groupAdminNamesKey(chatId), { [admin.user.id]: identityOf(admin.user) }));
  }
  await Promise.all(tasks);
}

/** Incremental update for a single user's admin status change — far cheaper
 * than a full resync, used from the chat_member update handler. `identity` is
 * required when promoting (needed for the impersonation check) and ignored
 * when demoting, since the name entry is dropped either way. */
export async function setUserAdminStatus(
  chatId: number,
  userId: number,
  isAdmin: boolean,
  identity?: AdminIdentity
): Promise<void> {
  const redis = getRedis();
  if (isAdmin) {
    const tasks: Promise<unknown>[] = [
      redis.sadd(groupAdminsKey(chatId), userId),
      redis.sadd(userAdminGroupsKey(userId), chatId),
    ];
    if (identity) tasks.push(redis.hset(groupAdminNamesKey(chatId), { [userId]: identity }));
    await Promise.all(tasks);
  } else {
    await Promise.all([
      redis.srem(groupAdminsKey(chatId), userId),
      redis.srem(userAdminGroupsKey(userId), chatId),
      redis.hdel(groupAdminNamesKey(chatId), String(userId)),
    ]);
  }
}

/** Admin display identities for a group — used only by the join-time
 * impersonation check (§15.2a); everything else needing "is this user an
 * admin" uses the cheaper ID-only set above. */
export async function getGroupAdminIdentities(chatId: number): Promise<Record<number, AdminIdentity>> {
  const all = await getRedis().hgetall<Record<string, AdminIdentity>>(groupAdminNamesKey(chatId));
  if (!all) return {};
  const result: Record<number, AdminIdentity> = {};
  for (const [id, identity] of Object.entries(all)) result[Number(id)] = identity;
  return result;
}

export async function getUserAdminGroupIds(userId: number): Promise<number[]> {
  const ids = await getRedis().smembers<string[]>(userAdminGroupsKey(userId));
  return (ids ?? []).map(Number);
}

/** The reverse direction — used by federation to find which real people
 * administer a given chat, before looking up each of their other groups. */
export async function getGroupAdminIds(chatId: number): Promise<number[]> {
  const ids = await getRedis().smembers<string[]>(groupAdminsKey(chatId));
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
    redis.del(groupAdminNamesKey(chatId)),
  ]);
}

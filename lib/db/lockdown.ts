import { getRedis } from "./redis";
import type { ChatPermissions } from "grammy/types";

/**
 * Chat-wide "read-only mode" (Combot's channel-mode / most top anti-spam
 * bots' "lock") — restricts EVERY non-admin from posting via
 * setChatPermissions, as opposed to restrictChatMember which targets one
 * user. This is the state needed to undo it correctly: Telegram's
 * setChatPermissions has no "restore previous" call, so the permissions the
 * chat had right before locking are captured here and replayed on unlock —
 * a hardcoded "everything back to true" would silently loosen a group that
 * had already restricted media/polls/etc. on its own.
 */
export interface LockdownState {
  permissions: ChatPermissions;
  lockedAt: number;
  lockedBy: number;
}

const lockdownKey = (chatId: number) => `group:${chatId}:lockdown`;

export async function saveLockdownState(chatId: number, state: LockdownState): Promise<void> {
  await getRedis().set(lockdownKey(chatId), state);
}

export async function getLockdownState(chatId: number): Promise<LockdownState | null> {
  return getRedis().get<LockdownState>(lockdownKey(chatId));
}

export async function clearLockdownState(chatId: number): Promise<void> {
  await getRedis().del(lockdownKey(chatId));
}

import type { Api } from "grammy";
import type { ChatPermissions } from "grammy/types";
import { getLockdownState, saveLockdownState, clearLockdownState } from "@/lib/db/lockdown";

/** Every permission forced off during a lockdown — the full ChatPermissions
 * surface, not just can_send_messages: a raider left with can_send_photos or
 * can_invite_users would just switch to that instead. */
const READ_ONLY_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
};

/** A reasonable "everything a normal group allows" fallback, used only when
 * there's nothing saved to restore (unlock called without a matching lock —
 * e.g. after a Redis flush) — matches Telegram's own default permissions for
 * a freshly created group. */
const DEFAULT_PERMISSIONS: ChatPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
};

export async function isLocked(chatId: number): Promise<boolean> {
  return (await getLockdownState(chatId)) !== null;
}

/**
 * Restricts every non-admin from posting/inviting/etc., after saving the
 * chat's current permissions so unlockChat can put them back exactly as
 * they were. Idempotent: re-locking an already-locked chat overwrites the
 * saved state (setChatPermissions would already be all-false here) rather
 * than snapshotting the already-restricted permissions on top of it.
 */
export async function lockChat(api: Api, chatId: number, lockedBy: number): Promise<void> {
  const existing = await getLockdownState(chatId);
  if (!existing) {
    const chat = await api.getChat(chatId);
    const permissions = "permissions" in chat ? (chat.permissions ?? DEFAULT_PERMISSIONS) : DEFAULT_PERMISSIONS;
    await saveLockdownState(chatId, { permissions, lockedAt: Date.now(), lockedBy });
  }
  // independent permissions: without this, Telegram infers some booleans
  // from others (e.g. can_send_other_messages implying can_send_messages)
  // instead of taking each field literally — irrelevant here since every
  // field is false, but kept consistent with unlockChat below.
  await api.setChatPermissions(chatId, READ_ONLY_PERMISSIONS, { use_independent_chat_permissions: true });
}

export async function unlockChat(api: Api, chatId: number): Promise<void> {
  const state = await getLockdownState(chatId);
  // Literal restore, not Telegram's implied-permission grouping — a saved
  // snapshot where e.g. can_send_messages was true but can_send_polls false
  // must come back exactly that way, not "loosened" by the implication.
  await api.setChatPermissions(chatId, state?.permissions ?? DEFAULT_PERMISSIONS, {
    use_independent_chat_permissions: true,
  });
  await clearLockdownState(chatId);
}

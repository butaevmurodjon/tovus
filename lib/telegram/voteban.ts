import type { Api } from "grammy";
import { getRedis } from "@/lib/db/redis";

// Same 1h window as the captcha's pending state (see captcha.ts) — long enough
// for a chat to notice and react, short enough that a stale button from days
// ago can't suddenly spring back to life.
const VOTE_TTL_SECONDS = 60 * 60;

const votersKey = (chatId: number, userId: number) => `voteban:${chatId}:${userId}`;
const promptKey = (chatId: number, userId: number) => `voteban:msg:${chatId}:${userId}`;

/** Marks a mute/ban notice as vote-eligible and records which message to edit
 * once the vote succeeds. Called right after notifyChat sends that message. */
export async function startVoteBan(chatId: number, userId: number, messageId: number): Promise<void> {
  await getRedis().set(promptKey(chatId, userId), messageId, { ex: VOTE_TTL_SECONDS });
}

export type VoteOutcome = "counted" | "already-voted" | "self-vote" | "no-active-voteban";

/**
 * Records one voter's click. `voterId === targetUserId` is rejected outright —
 * defense in depth on top of Telegram already preventing a banned user from
 * clicking anything in a chat they've been removed from (a muted user is
 * still IN the chat and could otherwise vote for their own release).
 * Uniqueness comes from SADD's own semantics (returns 0 on a repeat member),
 * not a separate "have they voted" read — no read-then-write race window.
 */
export async function castVote(
  chatId: number,
  targetUserId: number,
  voterId: number
): Promise<{ outcome: VoteOutcome; count: number }> {
  if (voterId === targetUserId) return { outcome: "self-vote", count: 0 };

  const redis = getRedis();
  const active = await redis.exists(promptKey(chatId, targetUserId));
  if (!active) return { outcome: "no-active-voteban", count: 0 };

  // Anchored to the SAME 1h window as promptKey (only set once, by
  // startVoteBan) — no per-vote TTL refresh here, or the two keys could drift
  // apart and leave a stale voter set outliving its own "active" check above.
  const key = votersKey(chatId, targetUserId);
  const added = await redis.sadd(key, voterId);
  if (added === 1) await redis.expire(key, VOTE_TTL_SECONDS);
  const count = await redis.scard(key);
  return { outcome: added === 1 ? "counted" : "already-voted", count };
}

export async function getVoteBanMessageId(chatId: number, userId: number): Promise<number | null> {
  const id = await getRedis().get<number>(promptKey(chatId, userId));
  return id ?? null;
}

export async function clearVoteBan(chatId: number, userId: number): Promise<void> {
  await Promise.all([getRedis().del(votersKey(chatId, userId)), getRedis().del(promptKey(chatId, userId))]);
}

/**
 * Reverses whatever sanction is currently active for `userId` in `chatId` —
 * full unban if kicked, full permissions restored if restricted (same set
 * verifyCaptcha uses on success). Reads the LIVE status rather than trusting
 * which action (mute vs ban) the vote button was attached to, since that
 * could be stale (e.g. an admin already manually intervened). Returns true
 * once nothing sanctioned remains — including the no-op case where the
 * member was already free (mute expired naturally, admin already unbanned).
 */
export async function liftSanction(api: Api, chatId: number, userId: number): Promise<boolean> {
  const member = await api.getChatMember(chatId, userId).catch(() => null);
  if (!member) return false;

  if (member.status === "kicked") {
    return api
      .unbanChatMember(chatId, userId, { only_if_banned: true })
      .then(() => true)
      .catch(() => false);
  }

  if (member.status === "restricted") {
    // Deliberately the same full-permissions set verifyCaptcha grants on
    // success (captcha.ts), not a narrower "back to chat defaults" reversal —
    // Telegram's restrictChatMember permissions are explicit per-member
    // overrides, not "inherit the chat's default_permissions", so this can in
    // principle grant more than an ordinary member has if the chat's own
    // defaults are stricter. Accepted as consistent with the existing
    // unmute path rather than introducing a second, different reversal shape.
    return api
      .restrictChatMember(chatId, userId, {
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
      })
      .then(() => true)
      .catch(() => false);
  }

  return true;
}

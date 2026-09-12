import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import type { GroupSettings } from "@/lib/db/types";
import { getRedis } from "@/lib/db/redis";
import { isChannelMember, invalidateChannelMembership } from "@/lib/db/channelMembership";
import { t, type Lang } from "@/lib/i18n";
import { mentionHtml } from "./format";

/** This bot's own promo channel — @tovus_antispam by default, overridable via
 * env for staging/testing. Never hardcode this literal anywhere else; always
 * go through this so there's exactly one place that changes it. */
export function promoChannelUsername(): string {
  return process.env.PROMO_CHANNEL_USERNAME || "tovus_antispam";
}

export interface ChannelGateSource {
  /** Which setting turned this source on — surfaced so callers can compose
   * the right prompt copy (owner-only / promo-only / both). */
  kind: "owner" | "promo";
  channelId: number;
  username: string | null;
}

/** Pure — no I/O. The sources a group's settings actually ask to gate on,
 * in a stable order (owner's channel first, promo second) so prompt copy
 * that lists "channel A and channel B" is deterministic. */
export function activeGateSources(settings: GroupSettings): ChannelGateSource[] {
  const sources: ChannelGateSource[] = [];
  if (settings.ownerChannelGateEnabled && settings.ownerChannelId !== null) {
    sources.push({ kind: "owner", channelId: settings.ownerChannelId, username: settings.ownerChannelUsername });
  }
  if (settings.promoChannelOptIn) {
    // No stored id for the promo channel — it's a fixed, bot-wide value, not
    // per-group config, so there's nothing to resolve/store per group.
    // Resolution to a numeric id happens lazily in resolvePromoChannelId.
    sources.push({ kind: "promo", channelId: 0, username: promoChannelUsername() });
  }
  return sources;
}

const PROMO_CHANNEL_ID_CACHE_KEY = "promochannel:id";
const PROMO_CHANNEL_ID_TTL_SECONDS = 24 * 60 * 60;

/** Resolves the promo channel's numeric id once and caches it — same
 * rationale as the owner channel storing its id after /setchannel, just
 * cached in Redis instead of per-group settings since it's one shared value. */
async function resolvePromoChannelId(api: Api): Promise<number | null> {
  const redis = getRedis();
  const cached = await redis.get<number>(PROMO_CHANNEL_ID_CACHE_KEY);
  if (cached !== null && cached !== undefined) return cached;
  try {
    const chat = await api.getChat(`@${promoChannelUsername()}`);
    await redis.set(PROMO_CHANNEL_ID_CACHE_KEY, chat.id, { ex: PROMO_CHANNEL_ID_TTL_SECONDS });
    return chat.id;
  } catch (err) {
    if (err instanceof GrammyError) return null;
    throw err;
  }
}

export interface GateCheckResult {
  /** True only when every active source is confirmed subscribed. */
  passed: boolean;
  /** Sources the user still needs to join — empty when passed is true. Any
   * source `isChannelMember` couldn't verify (bot not admin there, or the
   * promo channel id failed to resolve) is treated as passed for THAT source
   * (fail open — see channelMembership.ts's own contract) rather than
   * blocking the user for an owner-side setup problem. */
  unmet: ChannelGateSource[];
}

/** Checks every active source for one user. Does no muting/deleting itself —
 * callers (the message handler, or a "recheck" button) decide what to do
 * with the result. */
export async function checkChannelGate(
  api: Api,
  settings: GroupSettings,
  userId: number
): Promise<GateCheckResult> {
  const sources = activeGateSources(settings);
  if (sources.length === 0) return { passed: true, unmet: [] };

  const unmet: ChannelGateSource[] = [];
  for (const source of sources) {
    let channelId = source.channelId;
    if (source.kind === "promo") {
      const resolved = await resolvePromoChannelId(api);
      if (resolved === null) continue; // can't verify → fail open, skip this source
      channelId = resolved;
    }
    const subscribed = await isChannelMember(api, channelId, userId);
    if (!subscribed) unmet.push({ ...source, channelId });
  }
  return { passed: unmet.length === 0, unmet };
}

export async function invalidateGateCache(unmet: ChannelGateSource[], userId: number): Promise<void> {
  await Promise.all(unmet.map((s) => invalidateChannelMembership(s.channelId, userId)));
}

// --- per-(chat,user) prompt throttle --------------------------------------
// A blocked non-subscriber flooding the group would otherwise get a fresh
// "please subscribe" message deleted-and-reposted on every single message —
// same self-DoS shape autoNotice.ts avoids for deleteNotice, but scoped per
// user here (not per chat) since several different non-subscribers can be
// blocked in the same chat at once, and one shared pointer would delete
// each other's prompts instead of just the same user's stale one.

const PROMPT_COOLDOWN_SECONDS = 60;
const promptKey = (chatId: number, userId: number) => `channelgate:prompt:${chatId}:${userId}`;

/** True the FIRST time it's called for a (chat,user) within the cooldown
 * window — claims the cooldown atomically so a burst of messages in the same
 * tick can't all pass through before either has written it. */
export async function shouldShowGatePrompt(chatId: number, userId: number): Promise<boolean> {
  const res = await getRedis().set(promptKey(chatId, userId), 1, { nx: true, ex: PROMPT_COOLDOWN_SECONDS });
  return res === "OK";
}

// --- the actual prompt message --------------------------------------------

export function gateCallbackData(userId: number): string {
  return `chgate:${userId}`;
}

export const GATE_CALLBACK_PATTERN = /^chgate:(\d+)$/;

/** Posts (or re-posts) the "please subscribe" prompt for a blocked user —
 * used both from the message handler and, on a failed recheck, to refresh
 * the same message in place. `unmet` decides the wording: owner-only,
 * promo-only, or both. */
export async function sendChannelGatePrompt(
  api: Api,
  chatId: number,
  user: User,
  lang: Lang,
  unmet: ChannelGateSource[]
): Promise<void> {
  const hasOwner = unmet.some((s) => s.kind === "owner");
  const hasPromo = unmet.some((s) => s.kind === "promo");
  const textKey =
    hasOwner && hasPromo ? "bot.channelGateBothPrompt" : hasPromo ? "bot.channelGatePromoPrompt" : "bot.channelGateOwnerPrompt";

  const joinButtons = unmet
    .filter((s): s is ChannelGateSource & { username: string } => Boolean(s.username))
    .map((s) => ({ text: t(lang, "bot.channelGateJoinButton", { channel: `@${s.username}` }), url: `https://t.me/${s.username}` }));

  await api
    .sendMessage(chatId, t(lang, textKey, { user: mentionHtml(user) }), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          ...joinButtons.map((b) => [b]),
          [{ text: t(lang, "bot.channelGateRecheckButton"), callback_data: gateCallbackData(user.id) }],
        ],
      },
    })
    .catch(() => {});
}

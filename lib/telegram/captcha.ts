import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { User } from "grammy/types";
import { getRedis } from "@/lib/db/redis";
import { setPendingAction } from "@/lib/db/pendingAction";
import type { CaptchaType } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";
import { escapeHtml, mentionHtml } from "./format";

// Same rationale as welcome.ts's MAX_WELCOME_MESSAGE_LENGTH, but lower: the
// rules prompt embeds the mention AND boilerplate text around {rules}, on top
// of the rules text itself — a value this size still leaves headroom under
// Telegram's 4096-char sendMessage limit after both expansions.
export const MAX_RULES_TEXT_LENGTH = 3000;

/** Trims and caps an admin-entered rules template. Doesn't escape HTML here —
 * that happens at send time in startCaptcha, same as buildWelcomeText. */
export function normalizeRulesText(raw: string): string {
  return raw.trim().slice(0, MAX_RULES_TEXT_LENGTH);
}

const stateKey = (chatId: number, userId: number) => `captcha:${chatId}:${userId}`;
const pendingSetKey = (chatId: number) => `captcha:pending:${chatId}`;

interface CaptchaState {
  token: string;
  promptMessageId: number;
  type: CaptchaType;
  /** Only set for type "math" — the one button value that verifies the user. */
  correctAnswer?: number;
  /** Only set for type "message" — lowercased, compared against the trimmed/
   * lowercased text the member types back in private chat (see
   * verifyMessageCaptcha). The word itself is shown uppercase in the group
   * prompt; stored lowercase here so comparison is a single toLowerCase(). */
  word?: string;
  /** Wrong tries so far for "math"/"message" — the only two types where a
   * wrong guess is even possible ("button"/"rules" pass on any click). Starts
   * at 0 in startCaptcha; each wrong guess increments it, and hitting
   * MAX_CAPTCHA_ATTEMPTS kicks the member instead of leaving the same
   * fixed-option keyboard (math) or an unlimited DM retry (message) up
   * forever — a bot/human could otherwise just cycle every option or keep
   * guessing until right. */
  attempts: number;
}

/** Wrong guesses allowed before the member is kicked (not just re-muted) —
 * "math" shows a *new* question after each miss (see verifyCaptcha) so this
 * also bounds how many fixed 4-option boards the same member ever gets to
 * exhaustively click through; "message" just counts DM misses. */
export const MAX_CAPTCHA_ATTEMPTS = 3;

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Single-digit addition with 3 distinct, non-negative distractors — hard enough
 * to stop a plain click-bot, easy enough to never trip up a real human. */
function randomMathQuestion(): { a: number; b: number; correct: number; options: number[] } {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const correct = a + b;
  const wrong = new Set<number>();
  while (wrong.size < 3) {
    const delta = 1 + Math.floor(Math.random() * 5);
    const candidate = Math.random() < 0.5 ? correct - delta : correct + delta;
    if (candidate >= 0 && candidate !== correct) wrong.add(candidate);
  }
  return { a, b, correct, options: shuffle([correct, ...wrong]) };
}

// Excludes 0/O/1/I/L and lowercase-look-alikes — this gets typed back by hand
// from a phone keyboard after a context switch (group → deep link → private
// chat), so ambiguous glyphs cost real users a failed attempt, not just
// bots. Uppercase-only alphabet; comparison lowercases both sides.
const WORD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const WORD_LENGTH = 5;

/** Exported for tests only. */
export function randomWord(): string {
  let out = "";
  for (let i = 0; i < WORD_LENGTH; i++) {
    out += WORD_ALPHABET[Math.floor(Math.random() * WORD_ALPHABET.length)];
  }
  return out;
}

/** Builds one math-captcha screen (prompt text + answer keyboard) — shared by
 * startCaptcha (first question) and verifyCaptcha's retry path (a fresh
 * question after each wrong guess, so the member can't just click through
 * the same 4 fixed options). */
function buildMathCaptchaScreen(
  lang: Lang,
  user: User,
  token: string,
  seconds: number,
  attemptsLeft: number
): { text: string; correctAnswer: number; inline_keyboard: { text: string; callback_data: string }[][] } {
  const { a, b, correct, options: answerOptions } = randomMathQuestion();
  const key = attemptsLeft < MAX_CAPTCHA_ATTEMPTS ? "bot.captchaMathPromptRetry" : "bot.captchaMathPrompt";
  const text = t(lang, key, { user: mentionHtml(user), seconds, a, b, attemptsLeft });
  const buttons = answerOptions.map((value) => ({
    text: String(value),
    callback_data: `cap:${user.id}:${token}:${value}`,
  }));
  return { text, correctAnswer: correct, inline_keyboard: [buttons.slice(0, 2), buttons.slice(2)] };
}

/** `?start=capdm_<chatId>` — opens the bot in a PRIVATE chat for the "message"
 * captcha type: the group prompt shows a word but can't collect the typed
 * answer itself (the member is muted there), so it links here instead. Same
 * shape as commands.ts's appealUrl/referralUrl, kept local to this file to
 * avoid captcha.ts <-> commands.ts becoming a circular import (commands.ts
 * already imports normalizeRulesText from here). */
export function messageCaptchaUrl(chatId: number): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=capdm_${chatId}`;
}

/** `capdm_<chatId>` from a `?start=` payload — same digit/sign shape as
 * commands.ts's parseAppealPayload (chat ids are always negative for
 * supergroups). */
export function parseMessageCaptchaPayload(payload: string | undefined | null): number | null {
  if (!payload) return null;
  const match = /^capdm_(-?\d{1,15})$/.exec(payload.trim());
  if (!match) return null;
  const chatId = Number(match[1]);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

/** Mutes the new member and posts a "prove you're human" prompt — a one-tap
 * button, a simple math question when `type` is "math", an agree-to-rules
 * gate when "rules", or (type "message") a word to type back in a private
 * chat reached via deep link, since a muted member can't type in the group
 * itself. */
export async function startCaptcha(
  api: Api,
  chatId: number,
  user: User,
  lang: Lang,
  options: { type: CaptchaType; timeoutSeconds: number; rulesText?: string | null }
): Promise<void> {
  const token = randomToken();
  const { type, rulesText } = options;
  // "message" needs a longer runway than the shared group default (120s):
  // it adds a click-through-then-type round trip (group prompt → deep link →
  // Telegram switches chats → type the word) on top of what button/math/
  // rules need, and that extra hop is exactly the part most likely to stall
  // on a slow connection or a member who doesn't immediately notice the
  // button. Floors the effective window rather than trusting whatever the
  // group's shared captchaTimeoutSeconds happens to be — a group that set a
  // short timeout for the (fast) button/math types shouldn't silently kick
  // "message" members before they've had a real chance to complete a
  // multi-step flow they may not have even seen the button for yet.
  const MESSAGE_CAPTCHA_MIN_SECONDS = 180;
  const timeoutSeconds =
    type === "message" ? Math.max(options.timeoutSeconds, MESSAGE_CAPTCHA_MIN_SECONDS) : options.timeoutSeconds;
  const until = Math.floor(Date.now() / 1000) + timeoutSeconds;

  await api
    .restrictChatMember(chatId, user.id, { can_send_messages: false }, { until_date: until })
    .catch(() => {});

  let text: string;
  let correctAnswer: number | undefined;
  let word: string | undefined;
  let inline_keyboard: ({ text: string; callback_data: string } | { text: string; url: string })[][];

  if (type === "math") {
    const screen = buildMathCaptchaScreen(lang, user, token, timeoutSeconds, MAX_CAPTCHA_ATTEMPTS);
    correctAnswer = screen.correctAnswer;
    text = screen.text;
    inline_keyboard = screen.inline_keyboard;
  } else if (type === "rules") {
    const rules = rulesText ? escapeHtml(rulesText) : t(lang, "bot.captchaRulesDefault");
    text = t(lang, "bot.captchaRulesPrompt", { user: mentionHtml(user), seconds: timeoutSeconds, rules });
    inline_keyboard = [[{ text: t(lang, "bot.captchaRulesButton"), callback_data: `cap:${user.id}:${token}` }]];
  } else if (type === "message") {
    word = randomWord();
    const url = messageCaptchaUrl(chatId);
    text = t(lang, "bot.messageCaptchaGroupPrompt", {
      user: mentionHtml(user),
      seconds: timeoutSeconds,
      word,
    });
    // No URL means TELEGRAM_BOT_USERNAME isn't provisioned — same "just omit
    // the button" degrade addToGroupUrl's callers already use, rather than
    // rendering a broken link. The member still gets kicked on timeout same
    // as any other unanswered captcha; there's nothing else this can do.
    inline_keyboard = url ? [[{ text: t(lang, "bot.messageCaptchaOpenBotButton"), url }]] : [];
  } else {
    text = t(lang, "bot.captchaPrompt", { user: mentionHtml(user), seconds: timeoutSeconds });
    inline_keyboard = [[{ text: t(lang, "bot.captchaButton"), callback_data: `cap:${user.id}:${token}` }]];
  }

  const sent = await api.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup: inline_keyboard.length > 0 ? { inline_keyboard } : undefined,
  });

  const redis = getRedis();
  const state: CaptchaState = {
    token,
    promptMessageId: sent.message_id,
    type,
    correctAnswer,
    word: word?.toLowerCase(),
    attempts: 0,
  };
  await redis.set(stateKey(chatId, user.id), state, { ex: timeoutSeconds });
  await redis.sadd(pendingSetKey(chatId), user.id);
}

export type VerifyResult = "ok" | "wrong-user" | "wrong-answer" | "failed" | "expired-or-unknown";

/** Restores full send permissions and deletes the group prompt — the one
 * side effect every captcha type ends with once it's actually resolved.
 * Shared by verifyCaptcha (callback-based types) and verifyMessageCaptcha
 * (the DM-answered "message" type). */
async function restoreFullPermissionsAndClearPrompt(api: Api, chatId: number, userId: number, promptMessageId: number) {
  await api
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
    .catch(() => {});
  await api.deleteMessage(chatId, promptMessageId).catch(() => {});
}

/** Kicks (ban + immediate unban, same as sweepExpiredCaptchas' timeout path) a
 * member who exhausted their captcha attempts, clearing all captcha state so
 * a re-join starts fresh rather than instantly re-tripping stale state. */
async function kickForExhaustedAttempts(
  api: Api,
  chatId: number,
  userId: number,
  key: string,
  promptMessageId: number
): Promise<void> {
  const redis = getRedis();
  await Promise.all([redis.del(key), redis.srem(pendingSetKey(chatId), userId)]);
  await api.deleteMessage(chatId, promptMessageId).catch(() => {});
  await api.banChatMember(chatId, userId).catch(() => {});
  await api.unbanChatMember(chatId, userId, { only_if_banned: true }).catch(() => {});
}

/** Restores full permissions and clears the prompt once the right user clicks the
 * right button — for "math", `answer` must match the stored correct value; for
 * "button" it's ignored (any click from the right user passes, as before). A
 * wrong "math" guess doesn't just re-show the same 4 options (previously
 * lettng anyone pass by clicking every option in turn — a guaranteed win,
 * not a 25% chance): it burns an attempt, shows a brand-new question with
 * fresh numbers/options, and after MAX_CAPTCHA_ATTEMPTS wrong guesses kicks
 * the member instead of leaving the board up forever. */
export async function verifyCaptcha(
  api: Api,
  chatId: number,
  clickingUser: User,
  targetUserId: number,
  token: string,
  answer: number | undefined,
  lang: Lang
): Promise<VerifyResult> {
  const clickingUserId = clickingUser.id;
  if (clickingUserId !== targetUserId) return "wrong-user";

  const redis = getRedis();
  const key = stateKey(chatId, targetUserId);
  const state = await redis.get<CaptchaState>(key);
  if (!state || state.token !== token) return "expired-or-unknown";

  if (state.type === "math" && state.correctAnswer !== answer) {
    const attempts = (state.attempts ?? 0) + 1;
    if (attempts >= MAX_CAPTCHA_ATTEMPTS) {
      await kickForExhaustedAttempts(api, chatId, targetUserId, key, state.promptMessageId);
      return "failed";
    }

    const ttl = await redis.ttl(key);
    const secondsLeft = ttl && ttl > 0 ? ttl : 60;
    const attemptsLeft = MAX_CAPTCHA_ATTEMPTS - attempts;
    const screen = buildMathCaptchaScreen(lang, clickingUser, token, secondsLeft, attemptsLeft);
    await api
      .editMessageText(chatId, state.promptMessageId, screen.text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: screen.inline_keyboard },
      })
      .catch(() => {});
    await redis.set(
      key,
      { ...state, correctAnswer: screen.correctAnswer, attempts },
      { ex: secondsLeft }
    );
    return "wrong-answer";
  }

  await Promise.all([redis.del(key), redis.srem(pendingSetKey(chatId), targetUserId)]);
  await restoreFullPermissionsAndClearPrompt(api, chatId, targetUserId, state.promptMessageId);

  return "ok";
}

export type MessageCaptchaDmResult = "ok" | "not-found";

/**
 * Called from the `/start capdm_<chatId>` handler once the member clicks the
 * deep-link button from the group prompt. Looks up the still-pending group
 * captcha state for (chatId, userId) — note this is keyed by the TARGET
 * member's own id, so a different group member clicking the same URL button
 * (it's a URL, not a per-user callback) simply finds no matching state and
 * gets "not-found", with no separate "wrong user" check needed. On success,
 * registers a pendingAction so the member's NEXT private text message is
 * checked against the word (see verifyMessageCaptcha / commands.ts's
 * message:text listener) — TTL matches whatever's left on the group captcha
 * itself, so the DM step can never outlive the thing it's verifying.
 */
export async function startMessageCaptchaDm(userId: number, chatId: number): Promise<MessageCaptchaDmResult> {
  const redis = getRedis();
  const key = stateKey(chatId, userId);
  const state = await redis.get<CaptchaState>(key);
  if (!state || state.type !== "message" || !state.word) return "not-found";

  const ttl = await redis.ttl(key);
  const ttlSeconds = ttl && ttl > 0 ? ttl : 60;
  await setPendingAction(userId, "captcha", { chatId }, ttlSeconds);
  return "ok";
}

export type MessageVerifyResult = "ok" | "wrong-answer" | "expired-or-unknown";

/** The other half of the "message" captcha type — compares the text the
 * member typed in private chat against the word shown in the group prompt.
 * A wrong guess is NOT a terminal failure (unlike verifyCaptcha's
 * "wrong-answer", which here just means "try again"): the caller must leave
 * the pendingAction in place so the member can retype until the shared
 * timeout actually expires, exactly like getting the math question wrong
 * used to just re-show the same buttons. */
export async function verifyMessageCaptcha(
  api: Api,
  chatId: number,
  userId: number,
  rawAnswer: string
): Promise<MessageVerifyResult> {
  const redis = getRedis();
  const key = stateKey(chatId, userId);
  const state = await redis.get<CaptchaState>(key);
  if (!state || state.type !== "message" || !state.word) return "expired-or-unknown";
  if (rawAnswer.trim().toLowerCase() !== state.word) return "wrong-answer";

  await Promise.all([redis.del(key), redis.srem(pendingSetKey(chatId), userId)]);
  await restoreFullPermissionsAndClearPrompt(api, chatId, userId, state.promptMessageId);

  return "ok";
}

// Caps how many pending entries one sweep looks at — the ban+unban round trip
// for an actually-expired one is sequential (real Telegram API mutations), and
// an uncapped loop during a raid (large pending set) risks running this single
// webhook past the platform's timeout. The rest stays in `pending` and gets
// picked up by the next sweep (next message in the chat), not lost.
const SWEEP_BATCH_SIZE = 50;

/**
 * No persistent worker in this serverless/webhook deployment, so expiry is swept
 * lazily on the next incoming message for that chat rather than on a timer —
 * anyone who never verified in time gets kicked (not banned) the next time
 * someone talks in the group. Cheap: the pending set is normally empty or tiny.
 */
export async function sweepExpiredCaptchas(api: Api, chatId: number): Promise<void> {
  const redis = getRedis();
  const pending = await redis.smembers<string[]>(pendingSetKey(chatId));
  if (!pending || pending.length === 0) return;

  // `exists` checks are batched in parallel so the batch cap bounds actual
  // work, not just iteration count — during a raid, most of `pending` is
  // recently-issued captchas that are still active, and a sequential
  // check-then-continue loop would burn the whole cap on those without ever
  // reaching the ones actually due for a kick.
  const userIds = pending.slice(0, SWEEP_BATCH_SIZE).map(Number);
  const stillActiveFlags = await Promise.all(userIds.map((userId) => redis.exists(stateKey(chatId, userId))));
  const expiredUserIds = userIds.filter((_, i) => !stillActiveFlags[i]);

  for (const userId of expiredUserIds) {
    await api.banChatMember(chatId, userId).catch(() => {});
    const unbanned = await api
      .unbanChatMember(chatId, userId, { only_if_banned: true })
      .then(() => true)
      .catch((err) => {
        if (!(err instanceof GrammyError)) throw err;
        return false;
      });
    // Only clear the pending marker once the kick fully round-tripped (ban + unban).
    // If unban failed transiently, leave the marker so the next sweep retries it —
    // otherwise a flaky call here would leave someone permanently banned.
    if (unbanned) {
      await redis.srem(pendingSetKey(chatId), userId);
    }
  }
}

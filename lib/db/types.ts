import type { Lang } from "@/lib/i18n";

export type ViolationAction = "delete" | "warn" | "mute" | "ban";

export type ViolationCategory = "profanity" | "spam" | "premium";

/** Finer-grained breakdown of *why* a violation fired, additive to (never a
 * replacement for) ViolationCategory — a monthly digest saying "12 удалено"
 * is much less useful than "8 реклама, 3 скам, 1 опасный файл", but the
 * existing category buckets stay exactly as coarse as today/7d/30d and the
 * owner overview already expect. See lib/moderation/reasonTags.ts for how a
 * verdict maps down to one of these. */
export type ReasonTag =
  | "profanity"
  | "scam"
  | "apk"
  | "phishing_link"
  | "ads"
  | "ai"
  | "flood"
  | "cas"
  | "raid"
  | "globalban"
  | "other";

export type PlanTier = "free" | "pro";

/** "message" (type the shown word back, collected in **private chat** via a
 * deep link — the member is muted in-group, same as the other types, so the
 * answer can never be typed in the group itself) joins the existing
 * button/math/rules types. See lib/telegram/captcha.ts (startMessageCaptchaDm/
 * verifyMessageCaptcha). */
export type CaptchaType = "button" | "math" | "rules" | "message";

export interface GroupSettings {
  chatId: number;
  title: string;
  profanityFilter: boolean;
  antispam: boolean;
  premium: boolean;
  action: ViolationAction;
  logChannelId: number | null;
  lang: Lang;
  createdAt: number;
  /** Off by default — tucked into an "Advanced" section in the Mini App, not the main flow. */
  captchaEnabled: boolean;
  /** "button" (one-tap) / "math" (pick the correct sum) are Pro-gated like the
   * rest of captchaEnabled; "rules" (agree-to-rules gate, §15.3) is deliberately
   * free — closer in spirit to welcomeMessage than to the human-check types —
   * see the captchaType === "rules" carve-outs in commands.ts and the PATCH route. */
  captchaType: CaptchaType;
  /** Rules text shown (HTML-escaped) before the "I agree" button when
   * captchaType is "rules". Null falls back to a generic prompt — enabling
   * the rules-gate is never blocked on this being set first. */
  rulesText: string | null;
  /** Seconds before an unanswered captcha expires and the member is kicked. */
  captchaTimeoutSeconds: number;
  /** Mass-join detection; forces captcha verification on new members during a detected raid. Same eligibility gate as captcha. */
  antiraidEnabled: boolean;
  /** Same raid detection, but on by default (not opt-in) — protection for
   * groups that never touched `antiraidEnabled`. Explicitly turning
   * `antiraidEnabled` off also clears this (see updateGroupSettings), so
   * "off" in the UI means fully off, not silently still-protected. */
  antiraidAuto: boolean;
  /** Opt-in ban sharing: when true, a bot-triggered ban here also bans the
   * same user in every OTHER group this group's current admins also manage
   * that has this on too. Trust boundary is shared admin identity — never
   * spreads to a group with no admin in common with this one. */
  federationEnabled: boolean;
  /** Checks new joiners against CAS (cas.chat) — a free shared database of
   * known spam/scam accounts — and bans them on join, before they can post.
   * Free for everyone (no DeepSeek/size cost), on by default, opt-out. */
  casCheckEnabled: boolean;
  /** Off by default: existing groups using action="warn" get exactly the
   * behavior they always had unless they explicitly opt in — auto-escalating
   * to mute/ban after N warns is a real behavior change (a false positive
   * costs a real ban, not just a benign captcha click), so it must never turn
   * on silently. */
  warnEscalationEnabled: boolean;
  /** Warns within `warnTtlDays` before escalating to `warnAction`. */
  warnLimit: number;
  warnAction: "mute" | "ban";
  warnTtlDays: number;
  /** §15.4: unique chat-member clicks needed on the "vote to lift" button
   * under a mute/ban notice before it's auto-reversed. Never offered for
   * federated bans (see notifyChat) — a local vote can't undo a cross-group
   * decision. */
  voteBanThreshold: number;
  welcomeEnabled: boolean;
  /** May contain the literal placeholder "{user}", substituted with an HTML mention on send. */
  welcomeMessage: string | null;
  /** Deletes Telegram's own "X joined/added/left the group" service messages.
   * On by default — purely cosmetic chat cleanup, no moderation tradeoff. */
  deleteServiceMessages: boolean;
  /** Off by default: when the action is a silent "delete", also post one short
   * public notice ("сообщение удалено — не размещайте рекламу", with the
   * reaction time). The notice replaces itself on the next moderation event
   * (see lib/db/autoNotice.ts), so at most one is ever visible. Kept opt-in
   * because turning it on changes outward behaviour in the chat — the delete
   * action is silent by design otherwise. */
  deleteNotice: boolean;
  /** Off by default: deletes forwarded messages, links, and media/stickers from
   * a member for their first `restrictNewMembersMinutes` minutes after joining —
   * the dominant vector for freshly-joined spam/scam accounts (ad forwards,
   * phishing links) posted before any content pattern has a chance to repeat. */
  restrictNewMembersEnabled: boolean;
  restrictNewMembersMinutes: number;
  /** Quiet hours, as UTC hours (0-23) so the window never shifts with a
   * server/member timezone; start > end simply wraps past midnight. */
  nightModeEnabled: boolean;
  nightModeStartHour: number;
  nightModeEndHour: number;
  plan: PlanTier;
  /** Unix ms. Null unless a Stars subscription has ever been active for this group. */
  planExpiresAt: number | null;
  /** GROWTH.md §2.5: allows ONE inline "🛡 Защитить свой чат" button under a
   * warn/mute/ban notice — the bot's only in-chat growth surface. On by
   * default, but only ever rendered for groups without an active Pro plan
   * (see notifyChat): paying groups buy silence, among other things. */
  attributionEnabled: boolean;
  /** Telegram user id of whoever's `?start=ref_<id>` link led to this group
   * being added (GROWTH.md §2.4). Attribution/audit only — the reward payout
   * reads lib/db/referrals.ts, never this field, so a wrong value here can't
   * grant anyone anything. */
  referredBy: number | null;
  /** Free for everyone, on by default (see MONTHLYDIGEST scope decision) —
   * a monthly "what got removed" summary posted at the group's own best hour. */
  monthlyDigestEnabled: boolean;
  /** "YYYY-MM" (UTC) of the last month a digest was actually sent, or null.
   * The idempotency guard for the hourly cron: without it, a group whose
   * digest hour/day match would get re-sent every hour for the rest of that
   * hour's minute-0 window, and again on any redeploy/retry within the month. */
  lastDigestSentMonth: string | null;

  /** Opt-in: requires a captcha to be answered from the Telegram side BEFORE a
   * join-request-mode group approves the request at all (Bot API 10.1
   * answerChatJoinRequestQuery family), instead of the existing post-join
   * mute-then-captcha flow. Deliberately opt-in and additive — the existing
   * `chat_join_request` handler (bot.ts) leaves non-flagged requests pending
   * on purpose so manual-vetting groups keep control; this must never
   * auto-approve a request the admin hasn't effectively vetted via the
   * captcha, and must never touch requests when the flag is off. */
  joinRequestCaptchaEnabled: boolean;

  /** Force-sub gate to a channel of the GROUP OWNER'S OWN choosing (not this
   * bot's channel — see promoChannelOptIn for that). Null username/id means
   * "configured off" even if the boolean below is left on from a stale UI
   * state; both are checked together. */
  ownerChannelGateEnabled: boolean;
  /** Numeric chat id of the owner's channel, resolved once (via getChat) when
   * the owner sets the @username below, so per-message checks never need to
   * resolve a username — same reasoning as caching in getCachedMemberCount. */
  ownerChannelId: number | null;
  /** The @username as entered by the owner, kept only for display in the Mini
   * App / settings text — membership checks use ownerChannelId. */
  ownerChannelUsername: string | null;

  /** Opt-in "помочь проекту" toggle: when true, ALSO gates on subscription to
   * this bot's own promo channel (@tovus_antispam), on top of (or instead of)
   * ownerChannelGateEnabled. Off by default — MONETIZATION.md explicitly
   * rejects in-group advertising as a default; this only ever runs because an
   * owner opted in, never silently. */
  promoChannelOptIn: boolean;

  /** On by default, opt-out: when a non-admin member adds another bot to the
   * group, kick it immediately (ban+unban, so an admin can deliberately
   * re-add it later without a lingering ban). Closes the standard bypass
   * spammers use against every Bot-API moderator — a bot never sees another
   * bot's own messages (see bot.ts's join handler for the same "bots are
   * mutually blind" reasoning), so a spammer who gets their own bot into the
   * chat can post through it unmoderated. Admins can still add any bot they
   * want; this only blocks non-admin adds. ROADMAP.md §7.2 item 1. */
  blockUnauthorizedBots: boolean;

  /** Opt-in "block outright" content rules — ROADMAP.md §7.2 item 2. Empty
   * array = off (default). Layered on top of, not instead of, the
   * pattern-based spam.ts heuristics — see strictContentRules.ts for the
   * full reasoning. One multi-select field rather than five booleans, since
   * a group either wants zero tolerance for a given rule or doesn't (no
   * meaningful partial-severity version, unlike most other toggles here). */
  strictContentRules: import("@/lib/moderation/strictContentRules").StrictContentRule[];

  /** Off by default: when a member is banned (by us or by an admin, either
   * way — the `chat_member` update fires regardless of who did it), also
   * delete their other recent messages (lib/db/messageAuthors.ts's
   * getRecentMessageIds), not just the one that triggered the ban. Off by
   * default since it's a stronger, more visible behavior change than a
   * single deletion — same reasoning as deleteNotice/warnEscalationEnabled
   * defaulting off. ROADMAP.md §7.2 item 4. */
  purgeMessagesOnBan: boolean;

  /** Off by default (admin convenience, not a safety feature — ROADMAP.md
   * §7.2 item 5): when a member writes literal "@admin"/"@админ" (Telegram
   * never resolves that to a real user), ping the chat's actual non-hidden
   * admins instead. */
  adminTaggerEnabled: boolean;

  /** Off by default — ROADMAP.md §7.2 item 7: three join-time gates the Bot
   * API answers for free off the `User` object already fetched for every
   * joiner (no extra call beyond `getUserProfilePhotos` for the photo one).
   * A rejected joiner is kicked (ban+unban, same as blockUnauthorizedBots) —
   * not permanently banned, since fixing the profile (add a username/photo,
   * or nothing to fix for the premium gate) and rejoining is the expected
   * remedy, unlike a CAS/global-ban hit. */
  blockNoUsername: boolean;
  blockNoPhoto: boolean;
  /** "off" (default) / "block_premium" (kick joiners WHO HAVE Telegram
   * Premium — Lols' "С премиумом") / "block_non_premium" (kick joiners
   * WITHOUT it — Lols' "Без премиума"). One field, not two independent
   * booleans, since the two are mutually exclusive — nothing sensible
   * happens with both on at once. */
  premiumJoinFilter: "off" | "block_premium" | "block_non_premium";

  /** 0 = off (default). When > 0, a joiner whose Telegram user id is
   * estimated (lib/moderation/accountAge.ts — a public id→registration-date
   * table, no extra API call) to be younger than this many days is kicked
   * (ban+unban), same as the other join-time gates. ROADMAP.md §7.3 —
   * flagged there as the highest-ROI item after §7.2: mass-created spam
   * accounts are almost always fresh, unlike most other join signals here. */
  minAccountAgeDays: number;

  /** Off by default (ROADMAP.md §7.3): mutes (10 min, reactionSpam.ts) a
   * member who rapid-fires reactions across the chat — Telegram gives no API
   * to remove an already-placed reaction, same limitation @LolsBot's own
   * docs note, so the response is a short mute rather than a deletion. */
  reactionSpamEnabled: boolean;

  /** Off by default (ROADMAP.md §7.3 "OCR текста с картинок"): reads text
   * baked into a photo (lib/moderation/ocr.ts, external OCR.space API — see
   * that module's doc comment for the accepted legal-risk tradeoff) and
   * runs it through the same profanity/spam checks as ordinary text. No
   * effect at all unless `OCR_API_KEY` is also set bot-wide. */
  ocrEnabled: boolean;

  /** Off by default (ROADMAP.md §7.3 "Антипервонах"): in a discussion group
   * linked to a channel, deletes a comment posted within
   * ANTI_FIRST_COMMENT_WINDOW_SECONDS of the channel post it replies to —
   * spam bots monitor channel publications and race to be the first,
   * most-visible comment. Only relevant to channel-linked groups; a no-op
   * everywhere else since the check requires `reply_to_message.is_automatic_forward`. */
  antiFirstCommentEnabled: boolean;

  /** ROADMAP.md §7.3 "Ежедневная ИИ-сводка чата" — 2026-09-14 re-cut:
   * OWNER-ONLY now, no group-admin-facing toggle at all (the group's own
   * `dailySummaryEnabled` field was removed — this used to be a two-gate
   * design, the admin half is gone). Settable ONLY via the owner-only
   * `/api/miniapp/owner/groups/[groupId]/dailysummary` route (stripped from
   * the group PATCH route the same way `ownerChannelId` is) — the bot owner
   * alone decides which groups this runs for. The digest itself is no
   * longer posted into the source group either — see
   * `lib/db/digestHub.ts`: it goes to a separate hub supergroup the owner
   * controls, one forum topic per source group. */
  dailySummaryOwnerAllowed: boolean;
  /** "YYYY-MM-DD" (UTC) of the last day a summary was actually sent, or
   * null — idempotency guard, same shape as lastDigestSentMonth. */
  lastDailySummarySentDate: string | null;
}

export const DEFAULT_GROUP_SETTINGS: Omit<GroupSettings, "chatId" | "title" | "createdAt" | "lang"> = {
  profanityFilter: true,
  antispam: true,
  premium: false,
  action: "delete",
  logChannelId: null,
  captchaEnabled: false,
  captchaType: "button",
  rulesText: null,
  captchaTimeoutSeconds: 120,
  antiraidEnabled: false,
  antiraidAuto: true,
  federationEnabled: false,
  casCheckEnabled: true,
  warnEscalationEnabled: false,
  warnLimit: 3,
  warnAction: "mute",
  warnTtlDays: 7,
  voteBanThreshold: 3,
  welcomeEnabled: false,
  welcomeMessage: null,
  deleteServiceMessages: true,
  deleteNotice: false,
  restrictNewMembersEnabled: false,
  restrictNewMembersMinutes: 10,
  nightModeEnabled: false,
  // Compared against UTC hours (nightMode.ts), not local time. 18-2 UTC ==
  // 23:00-07:00 in Tashkent (UTC+5, no DST) — the timezone most groups are in.
  nightModeStartHour: 18,
  nightModeEndHour: 2,
  plan: "free",
  planExpiresAt: null,
  attributionEnabled: true,
  referredBy: null,
  monthlyDigestEnabled: true,
  lastDigestSentMonth: null,
  joinRequestCaptchaEnabled: false,
  ownerChannelGateEnabled: false,
  ownerChannelId: null,
  ownerChannelUsername: null,
  promoChannelOptIn: false,
  blockUnauthorizedBots: true,
  strictContentRules: [],
  purgeMessagesOnBan: false,
  adminTaggerEnabled: false,
  blockNoUsername: false,
  blockNoPhoto: false,
  premiumJoinFilter: "off",
  minAccountAgeDays: 0,
  reactionSpamEnabled: false,
  ocrEnabled: false,
  antiFirstCommentEnabled: false,
  dailySummaryOwnerAllowed: false,
  lastDailySummarySentDate: null,
};

export interface JournalEntry {
  id: string;
  chatId: number;
  messageId: number;
  userId: number;
  username: string | null;
  displayName: string;
  text: string;
  category: ViolationCategory;
  reason: string;
  action: ViolationAction;
  /** True when `action` was reached via warn escalation rather than the
   * group's configured `action`/`warnAction` directly — lets the journal show
   * "auto-escalated" instead of implying the admin configured this action for
   * this category outright. */
  escalated: boolean;
  timestamp: number;
  restored: boolean;
  /** §10.1.1 "почему сработало": a content-only re-run of the v2 spam scorer
   * (scoring.ts `collectSpamSignals` + `scoreSignals`) done at journal-write
   * time, purely to explain the entry. It is NOT what produced `action` (the
   * live pipeline is rule-based, not scored) and NOT the same number the
   * shadow screen shows — reputation/new-account modifiers are deliberately
   * excluded here (same rationale as corpusCollector: a feature of the message
   * alone). Empty `signals` is normal for profanity/flood/night-mode/
   * restricted-content verdicts, which `collectSpamSignals` doesn't model.
   * All three absent on entries written before this was added. */
  score?: number;
  signals?: { name: string; weight: number }[];
  /** Which `moderateMessage` detector produced the verdict: "spam-detector",
   * "profanity", "flood", "premium-ai", "restricted-content", "night-mode". */
  source?: string | null;
}

/**
 * A message a member sent to the bot in private, asking to reach the group's
 * admin(s) — the "Написать администратору" flow (see lib/db/appeals.ts,
 * lib/telegram/commands.ts). Never causes an action by itself; an admin
 * reviews it in the Mini App and acts (unban, or just dismiss) by hand.
 */
export interface AppealEntry {
  id: string;
  chatId: number;
  userId: number;
  username: string | null;
  displayName: string;
  text: string;
  createdAt: number;
  /**
   * "offer_sent": an admin priced a paid unban and the Stars invoice was
   * delivered to the appellant's private chat — still open until they pay
   * (→ "resolved", lib/telegram/bot.ts successful_payment) or an admin
   * dismisses it directly.
   * "payment_failed": the Stars payment succeeded but `unbanChatMember`
   * itself failed (bot lost ban rights, chat gone, etc.) — Telegram already
   * took the payer's money, so this MUST surface distinctly in the Mini App
   * rather than silently reading as "resolved" when the user is still
   * banned. Needs a human to sort out manually.
   */
  status: "open" | "offer_sent" | "resolved" | "dismissed" | "payment_failed";
  /** Set when an admin offers a paid unban (§ "Предложить платный разбан").
   * Never set by the bot itself — always a specific admin's per-case price,
   * never a default the bot suggests. */
  offerStars?: number;
  offeredAt?: number;
}

/**
 * A message a GROUP OWNER/ADMIN sent to the BOT OWNER (developer) — the
 * "Написать в поддержку" flow entered from the Mini App, conversation
 * relayed through the bot itself (see lib/db/supportTickets.ts,
 * lib/telegram/support.ts). Distinct from AppealEntry, which is a group
 * MEMBER reaching that group's admin — this is a group admin reaching the
 * bot's owner. No TTL: an owner must be able to reply to a ticket at any
 * point, so entries persist until explicitly resolved.
 */
export interface SupportTicket {
  id: string;
  /** Null when opened from the group-less broadcast "Связь с поддержкой"
   * button (lib/telegram/broadcast.ts's broadcastToAdmins) rather than a
   * per-group Mini App link — the admin is reaching out generally, not
   * about one specific group. */
  groupId: number | null;
  groupTitle: string | null;
  fromUserId: number;
  fromUsername: string | null;
  fromDisplayName: string;
  text: string;
  createdAt: number;
  status: "open" | "replied" | "resolved";
  /** chatId+messageId of the message relayed to the bot owner for THIS
   * ticket — an owner's Telegram "Reply" on that message is how a reply
   * routes back to `fromUserId` (see lib/telegram/support.ts). */
  ownerChatId: number;
  ownerMessageId: number;
}

export interface StatsBucket {
  total: number;
  profanity: number;
  spam: number;
  premium: number;
}

export interface AdminGroupSummary {
  chatId: number;
  title: string;
  premium: boolean;
  profanityFilter: boolean;
  antispam: boolean;
  hasPermissionIssue: boolean;
  plan: PlanTier;
  isPro: boolean;
}

/** A bot-owner-issued ban that applies across every group the bot manages,
 * not just one — see lib/telegram/globalBan.ts. */
export interface GlobalBanEntry {
  userId: number;
  reason: string;
  bannedAt: number;
  bannedBy: number;
}

/** One row of the bot-owner's cross-group overview (app/owner). */
export interface OwnerGroupSummary {
  chatId: number;
  title: string;
  plan: PlanTier;
  isPro: boolean;
  planExpiresAt: number | null;
  violationsToday: number;
  joinsToday: number;
  createdAt: number;
}

import type { Bot, Context } from "grammy";
import { GrammyError } from "grammy";
import {
  addToWhitelist,
  getGroupSettings,
  registerGroup,
  removeFromWhitelist,
  updateGroupSettings,
} from "@/lib/db/groups";
import { addCustomWord, addCustomWords, getCustomWords, removeCustomWord } from "@/lib/db/customWords";
import { getStats } from "@/lib/db/stats";
import { getReactionStats } from "@/lib/db/reactionStats";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { countReferrals, setPendingRef } from "@/lib/db/referrals";
import {
  addAppeal,
  clearPendingAppeal,
  getPendingAppeal,
  isAppealOnCooldown,
  setPendingAppeal,
  tryStartAppealCooldown,
} from "@/lib/db/appeals";
import {
  REFERRAL_GROUPS_FOR_REWARD,
  REFERRAL_MIN_MEMBERS,
  REFERRAL_REWARD_MONTHS,
} from "./referrals";
import { canUseProFeature, formatPlanLabel, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import { PRESETS, isPresetKey } from "@/lib/moderation/presets";
import { recordAdminLabel } from "@/lib/moderation/corpusCollector";
import { corpusEnabled } from "@/lib/db/corpus";
import { detectLang, isLang, t, type Lang } from "@/lib/i18n";
import type { ViolationAction } from "@/lib/db/types";
import { formatPermissionWarning, getBotPermissions, isBotAdminOfChat, isChatAdmin } from "./adminCheck";
import { sendUpgradeInvoice } from "./payments";
import { normalizeWelcomeMessage } from "./welcome";
import { normalizeRulesText, parseMessageCaptchaPayload, startMessageCaptchaDm, verifyMessageCaptcha } from "./captcha";
import { clearPendingActionIfKind, getPendingAction, setPendingAction } from "@/lib/db/pendingAction";
import { displayName } from "./format";
import { isSupportOnCooldown, tryStartSupportCooldown } from "@/lib/db/supportTickets";
import { ownerId } from "@/lib/owner";
import { parseSupportPayload, relayOwnerReply, sendSupportTicketToOwner } from "./support";

function miniAppButtonUrl(startParam: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?startapp=${startParam}`;
}

/**
 * One-tap "add me to a group" deep link. `admin=` pre-ticks the rights Telegram
 * shows in the add-to-group dialog — only the two the moderation pipeline
 * actually needs (delete_messages for every action, restrict_members for
 * mute/ban/captcha), so the prompt stays cheap to accept. Null when
 * TELEGRAM_BOT_USERNAME isn't provisioned; every caller must then simply omit
 * the button rather than render a broken one. GROWTH.md §2.2/§4.3.
 */
export function addToGroupUrl(): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?startgroup=true&admin=delete_messages+restrict_members`;
}

/** `?start=ref_<userId>` — opens the bot in a PRIVATE chat and delivers the
 * payload to bot.command("start") below, which is where attribution is stored
 * (GROWTH.md §2.4). */
export function referralUrl(userId: number): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=ref_${userId}`;
}

type InlineButton = { text: string; url: string } | { text: string; web_app: { url: string } };

/** Telegram rejects an empty `inline_keyboard`, and both of the buttons we
 * build come from independent env vars — so a keyboard has to be able to end
 * up with zero rows and degrade to "no markup at all", not to `[[]]`. */
function keyboardOrUndefined(rows: (InlineButton | null)[][]) {
  const inline_keyboard = rows.map((row) => row.filter((b): b is InlineButton => b !== null)).filter((r) => r.length > 0);
  return inline_keyboard.length > 0 ? { inline_keyboard } : undefined;
}

/** `ref_<digits>` from a `?start=` payload. Anything else (including `src_*`
 * campaign tags) yields null — the payload is attacker-controlled, so it's
 * only ever a plain positive Telegram user id or nothing. */
export function parseRefPayload(payload: string | undefined | null): number | null {
  if (!payload) return null;
  const match = /^ref_(\d{1,19})$/.exec(payload.trim());
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** `?start=appeal_<chatId>` — opens the bot in a PRIVATE chat and, once the
 * member sends their next message there, delivers it as an appeal to that
 * group's admins (see lib/db/appeals.ts, the /start and message:text
 * handlers below). Same shape as referralUrl above. */
export function appealUrl(chatId: number): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=appeal_${chatId}`;
}

/** `appeal_<chatId>` from a `?start=` payload — chatId is a Telegram group id,
 * always negative for supergroups, so the digits need a leading `-`. */
export function parseAppealPayload(payload: string | undefined | null): number | null {
  if (!payload) return null;
  const match = /^appeal_(-?\d{1,15})$/.exec(payload.trim());
  if (!match) return null;
  const chatId = Number(match[1]);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

async function requireGroupChat(ctx: Context, lang: Lang): Promise<boolean> {
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") return true;
  await ctx.reply(t(lang, "bot.groupOnlyCommand"));
  return false;
}

async function requireAdmin(ctx: Context, lang: Lang): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const ok = await isChatAdmin(ctx.api, ctx.chat.id, ctx.from.id);
  if (!ok) await ctx.reply(t(lang, "bot.notAdminCommand"));
  return ok;
}

async function langFor(ctx: Context): Promise<Lang> {
  if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
    const settings = await getGroupSettings(ctx.chat.id);
    if (settings) return settings.lang;
  }
  return detectLang(ctx.from?.language_code);
}

/** Shared gate for the size-limited Pro features (federation, active-hours analytics):
 * active Pro subscription, or small enough for the free grace. Captcha and antiraid
 * are unconditionally free (MONETIZATION.md §2 Phase 1) and no longer call this. */
async function requireProFeature(ctx: Context, lang: Lang, chatId: number): Promise<boolean> {
  const settings = await getGroupSettings(chatId);
  if (!settings) return false;
  const memberCount = await getCachedMemberCount(ctx.api, chatId);
  if (canUseProFeature(settings, memberCount)) return true;
  await ctx.reply(t(lang, "bot.proRequiredFeature", { limit: FREE_TIER_MAX_MEMBERS }));
  return false;
}

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const lang = await langFor(ctx);
    if (ctx.chat.type === "private") {
      const payload = ctx.match?.toString().trim() ?? "";

      // GROWTH.md §2.4 step 2: remember who referred this user until they
      // actually add the bot somewhere. Self-referrals are dropped here so
      // nothing downstream has to re-check. Never blocks the reply.
      const inviterId = parseRefPayload(payload);
      if (inviterId !== null && ctx.from && inviterId !== ctx.from.id) {
        await setPendingRef(ctx.from.id, inviterId).catch(() => {});
      }
      // `src_<campaign>` tags (landing page, catalogue listing, ad) — logged
      // only for now; GROWTH.md §4.4 wires these into GroupEvent.source later.
      if (/^src_[\w-]{1,32}$/.test(payload)) console.log("[start_src]", payload);

      // "Написать администратору" deep link from a ban notice or /contact_admin
      // (see appealUrl below). Puts this user into "waiting for appeal text"
      // state and replies with the prompt instead of the generic welcome —
      // the next private message from them becomes the appeal itself (handled
      // by the message:text listener further down).
      const appealChatId = parseAppealPayload(payload);
      if (appealChatId !== null && ctx.from) {
        const group = await getGroupSettings(appealChatId);
        if (!group) {
          await ctx.reply(t(lang, "bot.appealGroupUnavailable"));
          return;
        }
        if (await isAppealOnCooldown(appealChatId, ctx.from.id)) {
          await ctx.reply(t(group.lang, "bot.appealCooldown"));
          return;
        }
        await setPendingAppeal(ctx.from.id, appealChatId);
        await ctx.reply(t(group.lang, "bot.appealPrompt", { title: group.title }));
        return;
      }

      // "Написать разработчику" deep link from the Mini App (see supportUrl/
      // parseSupportPayload in ./support). Only a real admin of that group may
      // open a ticket "for" it — an arbitrary user hitting this link can't
      // impersonate a group owner just by knowing/guessing the chat id.
      const supportGroupId = parseSupportPayload(payload);
      if (supportGroupId !== null && ctx.from) {
        const group = await getGroupSettings(supportGroupId);
        if (!group) {
          await ctx.reply(t(lang, "bot.appealGroupUnavailable"));
          return;
        }
        if (!(await isChatAdmin(ctx.api, supportGroupId, ctx.from.id))) {
          await ctx.reply(t(lang, "bot.notAdminCommand"));
          return;
        }
        if (await isSupportOnCooldown(ctx.from.id)) {
          await ctx.reply(t(group.lang, "bot.supportCooldown"));
          return;
        }
        await setPendingAction(ctx.from.id, "support", { groupId: supportGroupId }, 30 * 60);
        await ctx.reply(t(group.lang, "bot.supportDmPrompt", { title: group.title }));
        return;
      }

      // "message" captcha type's deep link (see captcha.ts's messageCaptchaUrl/
      // startMessageCaptchaDm) — the group prompt showed a word this member
      // can't type back there (they're muted), so it sends them here instead.
      // "not-found" covers both "never had one" and "already expired/solved" —
      // same generic reply either way, nothing to distinguish for the user.
      const captchaDmChatId = parseMessageCaptchaPayload(payload);
      if (captchaDmChatId !== null && ctx.from) {
        const group = await getGroupSettings(captchaDmChatId);
        const dmLang = group?.lang ?? lang;
        const result = await startMessageCaptchaDm(ctx.from.id, captchaDmChatId);
        if (result === "not-found") {
          await ctx.reply(t(dmLang, "bot.messageCaptchaExpired"));
          return;
        }
        await ctx.reply(t(dmLang, "bot.messageCaptchaDmPrompt"));
        return;
      }

      const url = process.env.TELEGRAM_MINI_APP_URL;
      const addUrl = addToGroupUrl();
      await ctx.reply(t(lang, "bot.welcomePrivate"), {
        reply_markup: keyboardOrUndefined([
          [
            addUrl ? { text: t(lang, "bot.addToGroupButton"), url: addUrl } : null,
            url ? { text: t(lang, "bot.openPanelButton"), web_app: { url } } : null,
          ],
        ]),
      });
      return;
    }
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await registerGroup(ctx.chat.id, ctx.chat.title ?? "", detectLang(ctx.from?.language_code));
      // Appends the data-storage disclosure only once CORPUS_ENABLED actually
      // flips on in prod — until then this text never appears, no separate
      // deploy needed for it to show up the moment the flag does. Lives on
      // welcomeGroup (not welcomePrivate/help) since this is specifically
      // about moderating THIS group's members' content, not the bot generally.
      const notice = corpusEnabled() ? `\n\n${t(lang, "bot.dataStorageNotice")}` : "";
      await ctx.reply(t(lang, "bot.welcomeGroup") + notice);
    }
  });

  bot.command("help", async (ctx) => ctx.reply(t(await langFor(ctx), "bot.helpText")));

  // GROWTH.md §2.4: the user-facing half of the referral loop — their link plus
  // how far along they are. Deliberately private-only: a referral link posted
  // into a group would credit whoever clicked it there to the poster, and the
  // link is personal anyway.
  bot.command("invite", async (ctx) => {
    const lang = await langFor(ctx);
    if (!ctx.from) return;
    if (ctx.chat.type !== "private") return ctx.reply(t(lang, "bot.refPrivateOnly"));

    const link = referralUrl(ctx.from.id);
    if (!link) return ctx.reply(t(lang, "bot.refUnavailable"));

    const count = await countReferrals(ctx.from.id).catch(() => 0);
    const addUrl = addToGroupUrl();
    await ctx.reply(
      // `{target}` is the threshold and `{count}` is actual progress —
      // consistently, across both keys — so the two can't get swapped by
      // someone editing the strings later.
      t(lang, "bot.refInviteText", {
        link,
        target: REFERRAL_GROUPS_FOR_REWARD,
        months: REFERRAL_REWARD_MONTHS,
        minMembers: REFERRAL_MIN_MEMBERS,
      }) +
        "\n\n" +
        t(lang, "bot.refProgress", { count, target: REFERRAL_GROUPS_FOR_REWARD }),
      {
        reply_markup: keyboardOrUndefined([
          [addUrl ? { text: t(lang, "bot.addToGroupButton"), url: addUrl } : null],
        ]),
      }
    );
  });

  // Open to any member, not just admins — the whole point is a channel for
  // someone the admin toggles (banned/muted) don't otherwise have, plus
  // anyone who just wants to reach the admin (join request, question). Group
  // chat only: it hands out a private deep link, so there's nothing to do in
  // private chat itself (use it from the group you want to contact about).
  bot.command("contact_admin", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    const link = appealUrl(ctx.chat!.id);
    if (!link) return ctx.reply(t(lang, "bot.appealUnavailable"));
    await ctx.reply(t(lang, "bot.appealButtonPrompt"), {
      reply_markup: { inline_keyboard: [[{ text: t(lang, "bot.appealButton"), url: link }]] },
    });
  });

  bot.command("panel", async (ctx) => {
    const lang = await langFor(ctx);
    if (ctx.chat.type === "private") {
      const url = process.env.TELEGRAM_MINI_APP_URL;
      if (!url) return ctx.reply(t(lang, "bot.openPanel"));
      await ctx.reply(t(lang, "bot.openPanel"), {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "bot.openPanelButton"), web_app: { url } }]] },
      });
      return;
    }
    const url = miniAppButtonUrl(`g${ctx.chat.id}`);
    await ctx.reply(t(lang, "bot.openPanel"), {
      reply_markup: url ? { inline_keyboard: [[{ text: t(lang, "bot.openPanelButton"), url }]] } : undefined,
    });
  });

  bot.command("settings", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    const settings = await getGroupSettings(ctx.chat!.id);
    if (!settings) return ctx.reply(t(lang, "bot.groupOnlyCommand"));
    const onOff = (v: boolean) => t(lang, v ? "common.on" : "common.off");
    let message = t(lang, "bot.settingsHeader") + "\n" + t(lang, "bot.settingsLine", {
      profanity: onOff(settings.profanityFilter),
      antispam: onOff(settings.antispam),
      premium: onOff(settings.premium),
      action: t(lang, `bot.actionNames.${settings.action}`),
      lang: settings.lang === "ru" ? t(lang, "miniapp.russian") : t(lang, "miniapp.uzbek"),
      logChannel: settings.logChannelId ? String(settings.logChannelId) : t(lang, "miniapp.logChannelNotSet"),
    });

    // The block above only ever covered the original 6 fields — every toggle
    // added since (captcha, antiraid, channel-gate, ...) was configurable but
    // invisible here, so an admin had no text-command way to confirm what's
    // actually on without opening the Mini App. Surfaced explicitly after a
    // real support case where "почти всё включено" turned out to be
    // unverifiable from /settings alone.
    message += "\n" + t(lang, "bot.settingsExtraLine", {
      captcha: settings.captchaEnabled ? `${onOff(true)} (${settings.captchaType})` : onOff(false),
      joinRequestCaptcha: onOff(settings.joinRequestCaptchaEnabled),
      antiraid: onOff(settings.antiraidEnabled || settings.antiraidAuto),
      cas: onOff(settings.casCheckEnabled),
      restrictNewMembers: onOff(settings.restrictNewMembersEnabled),
      warnEscalation: onOff(settings.warnEscalationEnabled),
      nightMode: onOff(settings.nightModeEnabled),
      federation: onOff(settings.federationEnabled),
      ownerChannel:
        settings.ownerChannelGateEnabled && settings.ownerChannelUsername
          ? `${onOff(true)} (@${settings.ownerChannelUsername})`
          : onOff(false),
      promoChannel: onOff(settings.promoChannelOptIn),
      welcome: onOff(settings.welcomeEnabled),
      monthlyDigest: onOff(settings.monthlyDigestEnabled),
    });

    message += "\n" + t(lang, "bot.planStatusLine", { plan: formatPlanLabel(settings, lang) });

    const perms = await getBotPermissions(ctx.api, ctx.chat!.id);
    const warning = formatPermissionWarning(
      lang,
      {
        action: settings.action,
        captchaEnabled: settings.captchaEnabled,
        // antiraidAuto defaults true — a group can be silently protected (and
        // need restrict rights) even with the visible toggle off.
        antiraidEnabled: settings.antiraidEnabled || settings.antiraidAuto,
        federationEnabled: settings.federationEnabled,
      },
      perms
    );
    if (warning) message += "\n\n" + warning;

    await ctx.reply(message);
  });

  async function toggleCommand(
    name: string,
    key:
      | "profanityFilter"
      | "antispam"
      | "captchaEnabled"
      | "casCheckEnabled"
      | "restrictNewMembersEnabled"
      | "nightModeEnabled"
      | "monthlyDigestEnabled"
      | "joinRequestCaptchaEnabled"
  ) {
    bot.command(name, async (ctx) => {
      const lang = await langFor(ctx);
      if (!(await requireGroupChat(ctx, lang))) return;
      if (!(await requireAdmin(ctx, lang))) return;
      const arg = ctx.match?.toString().trim().toLowerCase();
      if (arg !== "on" && arg !== "off") return ctx.reply(`/${name} on|off`);
      await updateGroupSettings(ctx.chat!.id, { [key]: arg === "on" } as never);
      await ctx.reply(t(lang, "bot.settingUpdated"));
    });
  }
  toggleCommand("filter_profanity", "profanityFilter");
  toggleCommand("antispam", "antispam");
  toggleCommand("cascheck", "casCheckEnabled");
  toggleCommand("restrictnewmembers", "restrictNewMembersEnabled");
  toggleCommand("nightmode", "nightModeEnabled");
  toggleCommand("digest", "monthlyDigestEnabled");
  // Only has any effect for a group in "approve new members" mode — see the
  // chat_join_request handler in bot.ts. Harmless no-op otherwise, same as
  // toggling captchaEnabled on a group that never turned that mode on.
  toggleCommand("joinrequestcaptcha", "joinRequestCaptchaEnabled");

  bot.command("restrictminutes", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 1 || n > 1440) return ctx.reply(t(lang, "bot.restrictMinutesUsage"));
    await updateGroupSettings(ctx.chat!.id, { restrictNewMembersMinutes: n });
    await ctx.reply(t(lang, "bot.restrictMinutesSet", { minutes: n }));
  });

  bot.command("nighthours", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const parts = ctx.match?.toString().trim().split(/\s+/).filter(Boolean) ?? [];
    const isHour = (v: string) => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23;
    if (parts.length !== 2 || !isHour(parts[0]) || !isHour(parts[1])) {
      return ctx.reply(t(lang, "bot.nightHoursUsage"));
    }
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    await updateGroupSettings(ctx.chat!.id, { nightModeStartHour: start, nightModeEndHour: end });
    await ctx.reply(t(lang, "bot.nightHoursSet", { start, end }));
  });

  bot.command("captcha", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply("/captcha on|off");
    // Captcha is free for every group regardless of type or size (MONETIZATION.md
    // §2 Phase 1) — no Pro gate here any more.
    await updateGroupSettings(ctx.chat!.id, { captchaEnabled: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.captchaOn" : "bot.captchaOff"));
  });

  bot.command("captchatype", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "button" && arg !== "math" && arg !== "rules" && arg !== "message")
      return ctx.reply(t(lang, "bot.captchatypeUsage"));
    await updateGroupSettings(ctx.chat!.id, { captchaType: arg });
    await ctx.reply(t(lang, "bot.captchatypeSet", { type: arg }));
  });

  bot.command("rulestext", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const raw = ctx.match?.toString().trim() ?? "";
    if (!raw) return ctx.reply(t(lang, "bot.rulestextUsage"));
    if (raw.toLowerCase() === "off") {
      await updateGroupSettings(ctx.chat!.id, { rulesText: null });
      await ctx.reply(t(lang, "bot.rulestextCleared"));
      return;
    }
    await updateGroupSettings(ctx.chat!.id, { rulesText: normalizeRulesText(raw) });
    await ctx.reply(t(lang, "bot.rulestextSet"));
  });

  bot.command("captchatimeout", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 30 || n > 600) return ctx.reply(t(lang, "bot.captchatimeoutUsage"));
    await updateGroupSettings(ctx.chat!.id, { captchaTimeoutSeconds: n });
    await ctx.reply(t(lang, "bot.captchatimeoutSet", { seconds: n }));
  });

  bot.command("antiraid", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply(t(lang, "bot.antiraidUsage"));
    // Antiraid is free for every group regardless of size (MONETIZATION.md §2 Phase 1).
    await updateGroupSettings(ctx.chat!.id, { antiraidEnabled: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.antiraidOn" : "bot.antiraidOff"));
  });

  bot.command("federation", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply(t(lang, "bot.federationUsage"));
    if (arg === "on" && !(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
    await updateGroupSettings(ctx.chat!.id, { federationEnabled: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.federationOn" : "bot.federationOff"));
  });

  bot.command("upgrade", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    await sendUpgradeInvoice(ctx.api, ctx.chat!.id, lang);
  });

  bot.command("plan", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    const settings = await getGroupSettings(ctx.chat!.id);
    if (!settings) return;
    await ctx.reply(t(lang, "bot.planStatusLine", { plan: formatPlanLabel(settings, lang) }));
  });

  bot.command("preset", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (!arg) return ctx.reply(t(lang, "bot.presetUsage"));
    if (!isPresetKey(arg)) return ctx.reply(t(lang, "bot.presetUnknown"));
    const { added } = await addCustomWords(ctx.chat!.id, PRESETS[arg]);
    await ctx.reply(t(lang, "bot.presetApplied", { preset: arg, count: added }));
  });

  bot.command("welcome", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const raw = ctx.match?.toString().trim() ?? "";
    if (!raw) return ctx.reply(t(lang, "bot.welcomeUsage"));
    if (raw.toLowerCase() === "off") {
      await updateGroupSettings(ctx.chat!.id, { welcomeEnabled: false });
      await ctx.reply(t(lang, "bot.welcomeCleared"));
      return;
    }
    await updateGroupSettings(ctx.chat!.id, { welcomeEnabled: true, welcomeMessage: normalizeWelcomeMessage(raw) });
    await ctx.reply(t(lang, "bot.welcomeSet"));
  });

  bot.command("premium", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply("/premium on|off");
    const settings = await getGroupSettings(ctx.chat!.id);
    if (!settings) return;
    if (arg === "on" && settings.premium) return ctx.reply(t(lang, "bot.premiumAlreadyOn"));
    if (arg === "off" && !settings.premium) return ctx.reply(t(lang, "bot.premiumAlreadyOff"));
    await updateGroupSettings(ctx.chat!.id, { premium: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.premiumOn" : "bot.premiumOff"));
  });

  bot.command("action", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase() as ViolationAction;
    if (!["delete", "warn", "mute", "ban"].includes(arg)) return ctx.reply(t(lang, "bot.actionSetUsage"));
    await updateGroupSettings(ctx.chat!.id, { action: arg });
    await ctx.reply(t(lang, "bot.actionSet", { action: t(lang, `bot.actionNames.${arg}`) }));
  });

  bot.command("warnlimit", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 0 || n > 20) return ctx.reply(t(lang, "bot.warnLimitUsage"));
    await updateGroupSettings(ctx.chat!.id, { warnLimit: n, warnEscalationEnabled: n > 0 });
    await ctx.reply(n > 0 ? t(lang, "bot.warnLimitSet", { limit: n }) : t(lang, "bot.warnLimitDisabled"));
  });

  bot.command("votebanthreshold", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    const n = Number(arg);
    if (!arg || !Number.isInteger(n) || n < 1 || n > 50) return ctx.reply(t(lang, "bot.votebanthresholdUsage"));
    await updateGroupSettings(ctx.chat!.id, { voteBanThreshold: n });
    await ctx.reply(t(lang, "bot.votebanthresholdSet", { threshold: n }));
  });

  bot.command("warnaction", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "mute" && arg !== "ban") return ctx.reply(t(lang, "bot.warnActionUsage"));
    await updateGroupSettings(ctx.chat!.id, { warnAction: arg });
    await ctx.reply(t(lang, "bot.warnActionSet", { action: t(lang, `bot.actionNames.${arg}`) }));
  });

  bot.command("lang", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (!isLang(arg)) return ctx.reply("/lang ru|uz");
    await updateGroupSettings(ctx.chat!.id, { lang: arg });
    await ctx.reply(t(arg, "bot.langSet"));
  });

  bot.command("whitelist", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const parts = ctx.match?.toString().trim().split(/\s+/) ?? [];
    const [action, arg] = parts;
    const replied = ctx.message?.reply_to_message?.from;

    let targetId: number | null = replied?.id ?? null;
    if (!targetId && arg) {
      if (/^-?\d+$/.test(arg)) {
        targetId = Number(arg);
      } else if (arg.startsWith("@")) {
        try {
          const chat = await ctx.api.getChat(arg);
          targetId = chat.id;
        } catch {
          targetId = null;
        }
      }
    }
    if ((action !== "add" && action !== "remove") || !targetId) {
      return ctx.reply(t(lang, "bot.whitelistUsage"));
    }
    if (action === "add") {
      await addToWhitelist(ctx.chat!.id, targetId);
      await ctx.reply(t(lang, "bot.whitelistAdded"));
    } else {
      await removeFromWhitelist(ctx.chat!.id, targetId);
      await ctx.reply(t(lang, "bot.whitelistRemoved"));
    }
  });

  bot.command("customwords", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const raw = ctx.match?.toString().trim() ?? "";
    const spaceIndex = raw.indexOf(" ");
    const action = (spaceIndex === -1 ? raw : raw.slice(0, spaceIndex)).toLowerCase();
    const word = spaceIndex === -1 ? "" : raw.slice(spaceIndex + 1).trim();

    if (action === "list") {
      const words = await getCustomWords(ctx.chat!.id);
      if (words.length === 0) return ctx.reply(t(lang, "bot.customWordsEmpty"));
      await ctx.reply(`${t(lang, "bot.customWordsListHeader")}\n${words.map((w) => `• ${w}`).join("\n")}`);
      return;
    }
    if ((action === "add" || action === "remove") && word) {
      if (action === "add") {
        const { added } = await addCustomWord(ctx.chat!.id, word);
        await ctx.reply(t(lang, added ? "bot.customWordAdded" : "bot.customWordCapReached", { word }));
      } else {
        await removeCustomWord(ctx.chat!.id, word);
        await ctx.reply(t(lang, "bot.customWordRemoved", { word }));
      }
      return;
    }
    await ctx.reply(t(lang, "bot.customWordUsage"));
  });

  // /spam and /ham — admin reply on a message to feed the training corpus a
  // confirmed (gold) label (plan: .claude/plans/delightful-petting-peacock.md).
  // /spam also deletes the message (the admin is telling us the bot missed it);
  // /ham leaves it (an admin vouching that messages like this are fine). These
  // are a corpus-collection feature — inert (and honest about it) when
  // CORPUS_ENABLED is off, rather than silently doing a delete with no data
  // captured.
  for (const kind of ["spam", "ham"] as const) {
    bot.command(kind, async (ctx) => {
      const lang = await langFor(ctx);
      if (!(await requireGroupChat(ctx, lang))) return;
      if (!(await requireAdmin(ctx, lang))) return;
      if (!corpusEnabled()) return ctx.reply(t(lang, "bot.reportDisabled"));

      const target = ctx.message?.reply_to_message;
      if (!target || !ctx.from) return ctx.reply(t(lang, "bot.reportUsage"));

      const text = target.text ?? target.caption ?? "";
      const author = target.from;

      if (kind === "spam") {
        await ctx.api.deleteMessage(ctx.chat!.id, target.message_id).catch(() => {});
      }

      const status = await recordAdminLabel({
        chatId: ctx.chat!.id,
        messageId: target.message_id,
        userId: author?.id ?? null,
        username: author?.username ?? null,
        displayName: [author?.first_name, author?.last_name].filter(Boolean).join(" ") || null,
        text,
        entities: target.entities ?? target.caption_entities,
        isForward: Boolean(target.forward_origin),
        goldLabel: kind === "spam" ? "spam" : "none",
        goldSource: "admin_report",
        goldBy: ctx.from.id,
        message: target,
      }).catch(() => "skipped" as const);

      const doneKey =
        status === "stored"
          ? kind === "spam"
            ? "bot.reportSpamDone"
            : "bot.reportHamDone"
          : "bot.reportNoted";
      await ctx.reply(t(lang, doneKey));
    });
  }

  bot.command("logchannel", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    if (!arg || arg.toLowerCase() === "off") {
      await updateGroupSettings(ctx.chat!.id, { logChannelId: null });
      await ctx.reply(t(lang, "bot.logChannelCleared"));
      return;
    }
    try {
      const chat = await ctx.api.getChat(/^-?\d+$/.test(arg) ? Number(arg) : arg);
      if (!(await isBotAdminOfChat(ctx.api, chat.id))) {
        return ctx.reply(t(lang, "bot.logChannelUsage"));
      }
      await updateGroupSettings(ctx.chat!.id, { logChannelId: chat.id });
      await ctx.reply(t(lang, "bot.logChannelSet"));
    } catch (err) {
      if (err instanceof GrammyError) return ctx.reply(t(lang, "bot.logChannelUsage"));
      throw err;
    }
  });

  // Force-sub to the GROUP OWNER'S OWN channel — same shape as /logchannel:
  // the bot must already be an admin of that channel (so getChatMember calls
  // against it later actually work), checked once here rather than
  // discovered as a silent fail-open the first time a real member is gated.
  bot.command("setchannel", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim();
    if (!arg || arg.toLowerCase() === "off") {
      await updateGroupSettings(ctx.chat!.id, {
        ownerChannelGateEnabled: false,
        ownerChannelId: null,
        ownerChannelUsername: null,
      });
      await ctx.reply(t(lang, "bot.channelGateSetupSaved"));
      return;
    }
    try {
      const chat = await ctx.api.getChat(/^-?\d+$/.test(arg) ? Number(arg) : arg);
      if (chat.type !== "channel" || !(await isBotAdminOfChat(ctx.api, chat.id))) {
        return ctx.reply(t(lang, "bot.channelGateSetupInvalid"));
      }
      await updateGroupSettings(ctx.chat!.id, {
        ownerChannelId: chat.id,
        ownerChannelUsername: "username" in chat ? (chat.username ?? null) : null,
        ownerChannelGateEnabled: true,
      });
      await ctx.reply(t(lang, "bot.channelGateSetupSaved"));
    } catch (err) {
      if (err instanceof GrammyError) return ctx.reply(t(lang, "bot.channelGateSetupInvalid"));
      throw err;
    }
  });

  bot.command("channelgate", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply(t(lang, "bot.channelGateSetupUsage"));
    const settings = await getGroupSettings(ctx.chat!.id);
    if (arg === "on" && !settings?.ownerChannelId) return ctx.reply(t(lang, "bot.channelGateSetupUsage"));
    await updateGroupSettings(ctx.chat!.id, { ownerChannelGateEnabled: arg === "on" });
    await ctx.reply(t(lang, "bot.settingUpdated"));
  });

  // "Помочь проекту": strictly opt-in gate on THIS bot's own promo channel —
  // never bundled into another toggle, never on by default (MONETIZATION.md
  // §"реклама в групповом чате — не рассматриваем"). An admin who never runs
  // this command gets no promo-channel gating, full stop.
  bot.command("helpproject", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply(t(lang, "bot.channelGateSetupUsage"));
    await updateGroupSettings(ctx.chat!.id, { promoChannelOptIn: arg === "on" });
    await ctx.reply(t(lang, "bot.settingUpdated"));
  });

  bot.command("stats", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    const argRaw = ctx.match?.toString().trim().toLowerCase();
    const period = argRaw === "today" || argRaw === "30d" ? argRaw : "7d";
    const [stats, reaction] = await Promise.all([
      getStats(ctx.chat!.id, period),
      getReactionStats(ctx.chat!.id, period),
    ]);
    const periodLabel = period === "today" ? t(lang, "miniapp.periodToday") : period === "30d" ? t(lang, "miniapp.period30d") : t(lang, "miniapp.period7d");
    const reactionMs = reaction.base.meanVisibleMs ?? reaction.base.meanProcMs;
    const reactionLine =
      reactionMs === null
        ? ""
        : "\n" + t(lang, "bot.statsReactionLine", { seconds: (reactionMs / 1000).toFixed(1) });
    await ctx.reply(
      t(lang, "bot.statsHeader", { period: periodLabel }) +
        "\n" +
        t(lang, "bot.statsLine", {
          total: stats.total,
          profanity: stats.profanity,
          spam: stats.spam,
          premium: stats.premium,
        }) +
        reactionLine
    );
  });

  // The other half of the "message" captcha type, started by /start
  // capdm_<chatId> above (which registers the pendingAction). Registered
  // BEFORE the appeal listener below so a captcha answer always takes
  // priority over a same-user pending appeal in the unlikely case both are
  // outstanding at once — a captcha miss costs a kick, an appeal miss costs
  // nothing but waiting a bit longer to retype /start. A wrong guess does
  // NOT clear the pendingAction (unlike a correct one, or "expired"): the
  // member can keep retrying until the shared timeout in captcha.ts actually
  // runs out, same as getting the old math-question buttons wrong just let
  // you tap another button. Passes through for every case that isn't "this
  // exact private text is a pending captcha answer".
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    const pending = await getPendingAction(ctx.from.id);
    if (!pending || pending.kind !== "captcha") return next();

    const { chatId } = pending.payload as { chatId: number };
    const group = await getGroupSettings(chatId);
    const lang = group?.lang ?? detectLang(ctx.from.language_code);
    const result = await verifyMessageCaptcha(ctx.api, chatId, ctx.from.id, ctx.message.text);
    if (result === "wrong-answer") {
      await ctx.reply(t(lang, "bot.messageCaptchaWrongAnswer"));
      return;
    }
    await clearPendingActionIfKind(ctx.from.id, "captcha");
    if (result === "expired-or-unknown") {
      await ctx.reply(t(lang, "bot.messageCaptchaExpired"));
      return;
    }
    await ctx.reply(t(lang, "bot.messageCaptchaPassed"));
  });

  // The other half of the appeal flow started by /start appeal_<chatId>
  // (private-chat branch above) or /contact_admin's button. Explicitly
  // passes through (`next()`) for every case that isn't "this exact private
  // text is a pending appeal" — group messages in particular MUST reach the
  // moderation handler registered after registerCommands() in bot.ts, so this
  // can never silently swallow them.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next(); // let bot.command handlers match first
    const chatId = await getPendingAppeal(ctx.from.id);
    if (chatId === null) return next();

    await clearPendingAppeal(ctx.from.id);
    const group = await getGroupSettings(chatId);
    const lang = group?.lang ?? detectLang(ctx.from.language_code);
    if (!group) return ctx.reply(t(lang, "bot.appealGroupUnavailable"));

    // Claims the cooldown atomically (SET NX) BEFORE writing the appeal, not
    // after — two messages sent in quick succession (double-tap, duplicate
    // webhook delivery) both racing past a separate isAppealOnCooldown read
    // used to be able to both land as appeals. Only the caller that actually
    // wins this claim proceeds; the loser sees the same cooldown reply an
    // ordinary second-appeal attempt would.
    if (!(await tryStartAppealCooldown(chatId, ctx.from.id))) {
      return ctx.reply(t(lang, "bot.appealCooldown"));
    }

    // 2000 chars is generous for "why was I banned" / "please unban me" —
    // caps a determined abuser's single message from ballooning the Mini App
    // inbox card, not a real limit anyone hits by accident.
    const text = ctx.message.text.slice(0, 2000);
    await addAppeal({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      userId: ctx.from.id,
      username: ctx.from.username ?? null,
      displayName: displayName(ctx.from),
      text,
      createdAt: Date.now(),
      status: "open",
    });
    await ctx.reply(t(lang, "bot.appealSent", { title: group.title }));
  });

  // The bot owner replying (Telegram "Reply") to a relayed support ticket —
  // see lib/telegram/support.ts. Checked before the support-ticket-body
  // handler below since the owner is never the one with a pending "support"
  // action; this only ever matches messages FROM the owner, in their own
  // private chat with the bot, that reply to a message this bot sent them.
  // Any other private message from the owner (a command, ordinary chat, a
  // reply to something unrelated) falls through via next().
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from || ctx.from.id !== ownerId()) return next();
    const replyToId = ctx.message.reply_to_message?.message_id;
    if (replyToId === undefined) return next();

    const lang = detectLang(ctx.from.language_code);
    const result = await relayOwnerReply(ctx.api, ctx.from.id, replyToId, ctx.chat.id, ctx.message.text, lang);
    if (result === "not-a-reply" || result === "no-ticket") return next();
    if (result === "delivery-failed") {
      await ctx.reply(t(lang, "bot.supportReplyFailed"));
      return;
    }
    await ctx.reply(t(lang, "bot.supportReplyDelivered"));
  });

  // The other half of the support flow started by /start support_<groupId>
  // (private-chat branch above). Same next()-passthrough discipline as the
  // appeal handler: only a private text message from a user who currently
  // has a pending "support" action is consumed here.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    const pending = await getPendingAction(ctx.from.id);
    if (!pending || pending.kind !== "support") return next();

    await clearPendingActionIfKind(ctx.from.id, "support");
    const { groupId } = pending.payload as { groupId: number };
    const group = await getGroupSettings(groupId);
    const lang = group?.lang ?? detectLang(ctx.from.language_code);
    if (!group) return ctx.reply(t(lang, "bot.appealGroupUnavailable"));

    // Re-verify admin status at submit time, not just at /start time — an
    // admin demoted in between shouldn't still get a ticket through.
    if (!(await isChatAdmin(ctx.api, groupId, ctx.from.id))) {
      return ctx.reply(t(lang, "bot.notAdminCommand"));
    }

    if (!(await tryStartSupportCooldown(ctx.from.id))) {
      return ctx.reply(t(lang, "bot.supportCooldown"));
    }

    const text = ctx.message.text.slice(0, 2000);
    const ticket = await sendSupportTicketToOwner(ctx.api, ownerId(), {
      groupId,
      groupTitle: group.title,
      fromUserId: ctx.from.id,
      fromUsername: ctx.from.username ?? null,
      fromDisplayName: displayName(ctx.from),
      text,
    });
    if (!ticket) {
      // Owner unreachable — extremely unlikely (they'd have to have blocked
      // their own bot), but must not silently claim success.
      await ctx.reply(t(lang, "bot.appealUnavailable"));
      return;
    }
    await ctx.reply(t(lang, "bot.supportSent"));
  });
}

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
import { normalizeRulesText } from "./captcha";

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

/** Shared gate for captcha/antiraid: active Pro subscription, or small enough for the free grace. */
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
      await ctx.reply(t(lang, "bot.welcomeGroup"));
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
    if (arg === "on") {
      // The "rules" gate is deliberately free (§15.3) — closer in spirit to
      // welcomeMessage than to the button/math human-check types — so it skips
      // the Pro requirement the other two types still need.
      const settings = await getGroupSettings(ctx.chat!.id);
      const isFreeRulesGate = settings?.captchaType === "rules";
      if (!isFreeRulesGate && !(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
    }
    await updateGroupSettings(ctx.chat!.id, { captchaEnabled: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.captchaOn" : "bot.captchaOff"));
  });

  bot.command("captchatype", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "button" && arg !== "math" && arg !== "rules") return ctx.reply(t(lang, "bot.captchatypeUsage"));
    if (arg !== "rules" && !(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
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
    if (!(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
    await updateGroupSettings(ctx.chat!.id, { captchaTimeoutSeconds: n });
    await ctx.reply(t(lang, "bot.captchatimeoutSet", { seconds: n }));
  });

  bot.command("antiraid", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply(t(lang, "bot.antiraidUsage"));
    if (arg === "on" && !(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
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
}

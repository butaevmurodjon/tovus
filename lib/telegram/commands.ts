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
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { canUseProFeature, formatPlanLabel, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import { PRESETS, isPresetKey } from "@/lib/moderation/presets";
import { detectLang, isLang, t, type Lang } from "@/lib/i18n";
import type { ViolationAction } from "@/lib/db/types";
import { formatPermissionWarning, getBotPermissions, isBotAdminOfChat, isChatAdmin } from "./adminCheck";
import { sendUpgradeInvoice } from "./payments";
import { normalizeWelcomeMessage } from "./welcome";

function miniAppButtonUrl(startParam: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?startapp=${startParam}`;
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
      const url = process.env.TELEGRAM_MINI_APP_URL;
      await ctx.reply(t(lang, "bot.welcomePrivate"), {
        reply_markup: url
          ? { inline_keyboard: [[{ text: t(lang, "bot.openPanelButton"), web_app: { url } }]] }
          : undefined,
      });
      return;
    }
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await registerGroup(ctx.chat.id, ctx.chat.title ?? "", detectLang(ctx.from?.language_code));
      await ctx.reply(t(lang, "bot.welcomeGroup"));
    }
  });

  bot.command("help", async (ctx) => ctx.reply(t(await langFor(ctx), "bot.helpText")));

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

  async function toggleCommand(name: string, key: "profanityFilter" | "antispam" | "captchaEnabled") {
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

  bot.command("captcha", async (ctx) => {
    const lang = await langFor(ctx);
    if (!(await requireGroupChat(ctx, lang))) return;
    if (!(await requireAdmin(ctx, lang))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg !== "on" && arg !== "off") return ctx.reply("/captcha on|off");
    if (arg === "on" && !(await requireProFeature(ctx, lang, ctx.chat!.id))) return;
    await updateGroupSettings(ctx.chat!.id, { captchaEnabled: arg === "on" });
    await ctx.reply(t(lang, arg === "on" ? "bot.captchaOn" : "bot.captchaOff"));
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
    const stats = await getStats(ctx.chat!.id, period);
    const periodLabel = period === "today" ? t(lang, "miniapp.periodToday") : period === "30d" ? t(lang, "miniapp.period30d") : t(lang, "miniapp.period7d");
    await ctx.reply(
      t(lang, "bot.statsHeader", { period: periodLabel }) +
        "\n" +
        t(lang, "bot.statsLine", {
          total: stats.total,
          profanity: stats.profanity,
          spam: stats.spam,
          premium: stats.premium,
        })
    );
  });
}

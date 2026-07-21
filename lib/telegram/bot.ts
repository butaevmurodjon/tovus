import { Bot, webhookCallback } from "grammy";
import { getGroupSettings, isWhitelisted, registerGroup, unregisterGroup } from "@/lib/db/groups";
import { incrementActivity } from "@/lib/db/stats";
import { getCachedMemberCount } from "@/lib/db/memberCount";
import { canUseProFeature } from "@/lib/billing/plan";
import { moderateMessage } from "@/lib/moderation";
import { checkRaid, markNewMember } from "@/lib/moderation/flood";
import { detectLang, t } from "@/lib/i18n";
import { formatPermissionWarning, isChatAdmin } from "./adminCheck";
import { registerCommands } from "./commands";
import { applyViolation } from "./violations";
import { startCaptcha, sweepExpiredCaptchas, verifyCaptcha } from "./captcha";
import { sendWelcomeMessage } from "./welcome";
import { activateProPlan, parseProPayload } from "./payments";

let _bot: Bot | null = null;

export function getBot(): Bot {
  if (_bot) return _bot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const bot = new Bot(token);

  registerCommands(bot);

  // Bot added to / removed from a group, or promoted/demoted.
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = ctx.chat;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    const newMember = update.new_chat_member;

    if (newMember.status === "member" || newMember.status === "administrator") {
      await registerGroup(chat.id, chat.title ?? "", detectLang(update.from.language_code));
    } else if (newMember.status === "left" || newMember.status === "kicked") {
      await unregisterGroup(chat.id);
      return;
    }

    // Just got (re-)promoted — tell the admin right away if moderation still can't
    // do its job, instead of leaving them to discover it via a silently-skipped delete.
    if (newMember.status === "administrator") {
      const settings = await getGroupSettings(chat.id);
      const lang = settings?.lang ?? detectLang(update.from.language_code);
      const warning = formatPermissionWarning(
        lang,
        {
          action: settings?.action ?? "delete",
          captchaEnabled: settings?.captchaEnabled,
          antiraidEnabled: settings?.antiraidEnabled,
        },
        {
          isAdmin: true,
          canDeleteMessages: newMember.can_delete_messages,
          canRestrictMembers: newMember.can_restrict_members,
        }
      );
      await ctx.api.sendMessage(chat.id, warning ?? t(lang, "bot.permOk")).catch(() => {});
    }
  });

  // Track brand-new members so their first message gets a softer response.
  // "chat_member" updates only fire reliably for supergroups/channels — plain
  // "group" chats mostly signal joins via a new_chat_members service message
  // instead, handled below in the message listener. Both are wired so joins
  // are caught regardless of chat type.
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    const chat = ctx.chat;
    if (chat.type !== "group" && chat.type !== "supergroup") return;
    const wasIn = ["member", "administrator", "creator", "restricted"].includes(update.old_chat_member.status);
    const isIn = ["member", "restricted"].includes(update.new_chat_member.status);
    if (!wasIn && isIn) {
      await markNewMember(chat.id, update.new_chat_member.user.id);
    }
  });

  // Captcha "I'm not a bot" button.
  bot.callbackQuery(/^cap:(\d+):(\w+)$/, async (ctx) => {
    const chat = ctx.chat;
    if (!chat) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, targetIdStr, token] = ctx.match;
    const targetUserId = Number(targetIdStr);
    const settings = await getGroupSettings(chat.id);
    const lang = settings?.lang ?? detectLang(ctx.callbackQuery.from.language_code);

    const result = await verifyCaptcha(ctx.api, chat.id, ctx.callbackQuery.from.id, targetUserId, token);
    if (result === "wrong-user") {
      await ctx.answerCallbackQuery({ text: t(lang, "bot.captchaWrongUser"), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
  });

  // Stars checkout: must answer within 10s. No stock/shipping to validate — always OK.
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // Registered ahead of, and NOT scoped to, the group-only handler below: a payment
  // started via the Mini App's openInvoice() can land as a successful_payment in the
  // bot's private chat with the admin rather than in the group itself. The target
  // group is always resolved from the invoice payload, never from where the
  // confirmation happened to arrive — see createUpgradeInvoiceLink.
  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const targetChatId = parseProPayload(payment.invoice_payload) ?? ctx.chat.id;
    const expiresAtMs = payment.subscription_expiration_date
      ? payment.subscription_expiration_date * 1000
      : Date.now() + 30 * 24 * 60 * 60 * 1000;
    await activateProPlan(targetChatId, expiresAtMs);
    const settings = await getGroupSettings(targetChatId);
    const lang = settings?.lang ?? "ru";
    const dateLabel = new Date(expiresAtMs).toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU");
    await ctx.reply(t(lang, "bot.paymentThanks", { date: dateLabel })).catch(() => {});
  });

  bot.on(["message", "edited_message"], async (ctx) => {
    const message = ctx.message ?? ctx.editedMessage;
    const chat = ctx.chat;
    if (!message || !chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const settings = await getGroupSettings(chat.id);

    if (message.new_chat_members?.length) {
      const newMembers = message.new_chat_members.filter((member) => !member.is_bot);
      await Promise.all(newMembers.map((member) => markNewMember(chat.id, member.id)));
      if (settings) {
        const memberCount = await getCachedMemberCount(ctx.api, chat.id);
        const eligible = canUseProFeature(settings, memberCount);
        await Promise.all(
          newMembers.map(async (member) => {
            await incrementActivity(chat.id, "joins").catch(() => {});
            const isRaid = settings.antiraidEnabled && eligible ? await checkRaid(chat.id) : false;
            if ((settings.captchaEnabled && eligible) || isRaid) {
              await startCaptcha(ctx.api, chat.id, member, settings.lang).catch(() => {});
            } else if (settings.welcomeEnabled && settings.welcomeMessage) {
              await sendWelcomeMessage(ctx.api, chat.id, member, settings.welcomeMessage).catch(() => {});
            }
          })
        );
      }
      return;
    }

    const from = message.from;
    if (!from || from.is_bot) return;
    if (!settings) return;

    await Promise.all([
      sweepExpiredCaptchas(ctx.api, chat.id).catch(() => {}),
      incrementActivity(chat.id, "messages").catch(() => {}),
    ]);

    const [admin, whitelisted] = await Promise.all([
      isChatAdmin(ctx.api, chat.id, from.id),
      isWhitelisted(chat.id, from.id),
    ]);
    if (admin || whitelisted) return;

    const verdict = await moderateMessage(message, settings);
    if (!verdict) return;

    await applyViolation(ctx.api, message, settings, verdict);
  });

  bot.catch((err) => {
    console.error("[bot] unhandled error", err.error);
  });

  _bot = bot;
  return bot;
}

export function getWebhookHandler() {
  return webhookCallback(getBot(), "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
    onTimeout: "return",
    timeoutMilliseconds: 25_000,
  });
}

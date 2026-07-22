import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { ViolationAction } from "@/lib/db/types";
import { t, type Lang } from "@/lib/i18n";

const ADMIN_STATUSES = new Set(["creator", "administrator"]);

/**
 * Live-checks admin status via getChatMember so that a user who lost their
 * admin rights loses access immediately — no cached role is trusted.
 */
export async function isChatAdmin(api: Api, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await api.getChatMember(chatId, userId);
    return ADMIN_STATUSES.has(member.status);
  } catch (err) {
    if (err instanceof GrammyError) return false;
    throw err;
  }
}

/** Whether the bot itself is currently an admin of the given chat — used to
 * gate accepting a log-channel id, since forwarding there silently no-ops
 * forever (each attempt just .catch()es) if the bot was never actually made
 * an admin of that channel. */
export async function isBotAdminOfChat(api: Api, chatId: number): Promise<boolean> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);
    return ADMIN_STATUSES.has(member.status);
  } catch (err) {
    if (err instanceof GrammyError) return false;
    throw err;
  }
}

export interface BotPermissions {
  isAdmin: boolean;
  canDeleteMessages: boolean;
  canRestrictMembers: boolean;
}

/** What the bot actually has in this chat right now — used to warn admins before moderation silently no-ops. */
export async function getBotPermissions(api: Api, chatId: number): Promise<BotPermissions> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);
    if (member.status !== "administrator") {
      return { isAdmin: false, canDeleteMessages: false, canRestrictMembers: false };
    }
    return {
      isAdmin: true,
      canDeleteMessages: member.can_delete_messages,
      canRestrictMembers: member.can_restrict_members,
    };
  } catch (err) {
    if (err instanceof GrammyError) return { isAdmin: false, canDeleteMessages: false, canRestrictMembers: false };
    throw err;
  }
}

export interface PermissionContext {
  action: ViolationAction;
  /** Captcha/antiraid both mute-then-unmute members, so they need restrict rights too. */
  captchaEnabled?: boolean;
  antiraidEnabled?: boolean;
}

/** Which capabilities the configured action (and captcha/antiraid, if on) need that the bot doesn't currently have. */
export function missingPermissionsFor(ctx: PermissionContext, perms: BotPermissions): string[] {
  if (!perms.isAdmin) return ["admin"];
  const missing: string[] = [];
  // Every action deletes the offending message first.
  if (!perms.canDeleteMessages) missing.push("delete");
  const needsRestrict = ctx.action === "mute" || ctx.action === "ban" || ctx.captchaEnabled || ctx.antiraidEnabled;
  if (needsRestrict && !perms.canRestrictMembers) missing.push("restrict");
  return missing;
}

/** Every reason restrict rights are actually needed here — the action alone may not be why. */
function restrictReasons(lang: Lang, ctx: PermissionContext): string[] {
  const reasons: string[] = [];
  if (ctx.action === "mute" || ctx.action === "ban") reasons.push(t(lang, `bot.actionNames.${ctx.action}`));
  if (ctx.captchaEnabled) reasons.push(t(lang, "miniapp.captchaTitle"));
  if (ctx.antiraidEnabled) reasons.push(t(lang, "miniapp.antiraidTitle"));
  return reasons;
}

/** Renders the permission gap as chat text, or null when everything needed is in place. */
export function formatPermissionWarning(lang: Lang, ctx: PermissionContext, perms: BotPermissions): string | null {
  const missing = missingPermissionsFor(ctx, perms);
  if (missing.length === 0) return null;
  const lines = [t(lang, "bot.permWarningHeader")];
  if (missing.includes("admin")) lines.push(`• ${t(lang, "bot.permMissingAdmin")}`);
  if (missing.includes("delete")) lines.push(`• ${t(lang, "bot.permMissingDelete")}`);
  if (missing.includes("restrict")) {
    // Falls back to the action name if somehow nothing else qualified — missingPermissionsFor
    // only ever sets "restrict" when at least one of these is actually true, so this is just
    // a defensive default, not expected in practice.
    const reasons = restrictReasons(lang, ctx);
    const reasonText = reasons.length > 0 ? reasons.join(", ") : t(lang, `bot.actionNames.${ctx.action}`);
    lines.push(`• ${t(lang, "bot.permMissingRestrict", { action: reasonText })}`);
  }
  return lines.join("\n");
}

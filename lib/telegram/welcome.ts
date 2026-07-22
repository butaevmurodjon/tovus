import type { Api } from "grammy";
import type { User } from "grammy/types";
import { escapeHtml, mentionHtml } from "./format";

// Headroom under Telegram's 4096-char sendMessage limit — the {user} placeholder
// gets replaced with a longer <a href="tg://user?id=...">name</a> mention, so the
// cap on the raw admin-entered template needs slack for that expansion.
export const MAX_WELCOME_MESSAGE_LENGTH = 3500;

/** Trims and caps an admin-entered welcome template. Doesn't escape HTML here —
 * that happens at send time in sendWelcomeMessage, once, right before the
 * {user} substitution, so callers can still store/echo the raw text as typed. */
export function normalizeWelcomeMessage(raw: string): string {
  return raw.trim().slice(0, MAX_WELCOME_MESSAGE_LENGTH);
}

/** The template is admin-entered free text, not markup — without escaping, a
 * single stray "<" makes Telegram reject the whole message as invalid HTML,
 * and the send silently no-ops. Escape it first, then substitute the
 * (already HTML-safe) mention so the link itself still renders. */
export function buildWelcomeText(template: string, user: User): string {
  return escapeHtml(template).replaceAll("{user}", mentionHtml(user));
}

export async function sendWelcomeMessage(
  api: Api,
  chatId: number,
  user: User,
  template: string
): Promise<void> {
  const text = buildWelcomeText(template, user);
  await api.sendMessage(chatId, text, { parse_mode: "HTML" }).catch(() => {});
}

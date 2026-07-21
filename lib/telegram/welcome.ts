import type { Api } from "grammy";
import type { User } from "grammy/types";
import { mentionHtml } from "./format";

export async function sendWelcomeMessage(
  api: Api,
  chatId: number,
  user: User,
  template: string
): Promise<void> {
  const text = template.replaceAll("{user}", mentionHtml(user));
  await api.sendMessage(chatId, text, { parse_mode: "HTML" }).catch(() => {});
}

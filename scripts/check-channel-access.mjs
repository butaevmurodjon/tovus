#!/usr/bin/env node
/**
 * Diagnostic: confirms which bot TELEGRAM_BOT_TOKEN belongs to, and whether
 * that bot can see/post to @tovus_antispam. Never prints the token itself.
 *
 * Usage: node --env-file=.env.local scripts/check-channel-access.mjs
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}

const CHANNEL = "@tovus_antispam";

const api = (method, params = "") =>
  fetch(`https://api.telegram.org/bot${token}/${method}${params}`).then((r) => r.json());

const me = await api("getMe");
console.log("getMe:", me.ok ? `@${me.result.username} (id ${me.result.id})` : me);

const chat = await api("getChat", `?chat_id=${encodeURIComponent(CHANNEL)}`);
console.log("getChat(@tovus_antispam):", chat.ok ? chat.result : chat);

if (me.ok) {
  const member = await api(
    "getChatMember",
    `?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${me.result.id}`
  );
  console.log("getChatMember (this bot in that channel):", member.ok ? member.result : member);
}

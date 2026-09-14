#!/usr/bin/env node
/**
 * Registers the deployed webhook URL with Telegram.
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *   node scripts/set-webhook.mjs https://your-app.vercel.app
 *
 * Keep the `allowed_updates` list below in sync with app/api/health/route.ts's
 * ALLOWED_UPDATES — that route re-runs this same setWebhook call
 * automatically (self-heal) whenever it finds the webhook unhealthy, and an
 * omitted/mismatched allowed_updates list resets what Telegram delivers.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const origin = process.argv[2];

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}
if (!origin) {
  console.error("Usage: node scripts/set-webhook.mjs https://your-app.vercel.app");
  process.exit(1);
}

const url = `${origin.replace(/\/$/, "")}/api/telegram/webhook`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret || undefined,
    allowed_updates: [
      "message",
      "edited_message",
      "my_chat_member",
      "chat_member",
      "callback_query",
      "pre_checkout_query",
      // ROADMAP.md §7.3 "Спам реакциями" — Telegram never sends this update
      // at all unless it's explicitly listed here, even if the bot is an
      // admin of the chat.
      "message_reaction",
    ],
    drop_pending_updates: false,
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!data.ok) process.exit(1);

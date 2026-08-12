#!/usr/bin/env node

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

const chatId = process.env.CHAT_ID;
const messageId = process.env.MESSAGE_ID;
if (!chatId || !messageId) {
  console.error('Set CHAT_ID and MESSAGE_ID environment variables');
  console.error("The message ID cannot be deduced from its text; you must obtain it using getUpdates or similar.");
  process.exit(1);
}

const url = `https://api.telegram.org/bot${token}/deleteMessage`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: Number(chatId),
    message_id: Number(messageId),
  }),
});
const data = await res.json();
if (!data.ok) {
  console.error(`Telegram error: ${data.description}`);
  process.exit(1);
}
console.log('Message deleted');

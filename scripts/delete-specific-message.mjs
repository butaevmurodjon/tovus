#!/usr/bin/env node

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

const chatId = process.env.CHAT_ID;
const messageId = process.env.MESSAGE_ID;
const userId = process.env.USER_ID;
const text = process.env.TEXT;

if (!chatId) {
  console.error('Set CHAT_ID environment variable');
  process.exit(1);
}

// Если messageId уже известен — просто удаляем.
if (messageId) {
  const url = `https://api.telegram.org/bot${token}/deleteMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chatId), message_id: Number(messageId) }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram error: ${data.description}`);
    process.exit(1);
  }
  console.log('Message deleted');
  process.exit(0);
}

// Если messageId не задан, пытаемся найти сообщение по тексту и отправителю
// через getUpdates (если вебхук активен — временно отключаем его).
if (!userId || !text) {
  console.error('Set MESSAGE_ID or both USER_ID and TEXT');
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}`;

// 1. Сохраняем текущий вебхук (если он установлен)
let webhookUrl = null;
try {
  const info = await (await fetch(`${apiUrl}/getWebhookInfo`)).json();
  if (info.ok && info.result?.url) webhookUrl = info.result.url;
} catch {}

// 2. Отключаем вебхук, чтобы иметь доступ к getUpdates
if (webhookUrl) {
  await fetch(`${apiUrl}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: false }),
  });
}

// 3. Перебираем последние обновления в поисках нужного сообщения
let foundMessageId = null;
try {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${apiUrl}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout: 0, allowed_updates: ["message"] }),
    });
    const data = await res.json();
    if (!data.ok) continue;
    for (const upd of data.result) {
      const msg = upd.message;
      if (!msg) continue;
      if (
        msg.chat?.id === Number(chatId) &&
        msg.from?.id === Number(userId) &&
        msg.text === text
      ) {
        foundMessageId = msg.message_id;
        // Помечаем обновления как обработанные
        await fetch(`${apiUrl}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset: upd.update_id + 1 }),
        });
        break;
      }
    }
    if (foundMessageId) break;
  }
} finally {
  // 4. Восстанавливаем вебхук, если он был
  if (webhookUrl) {
    await fetch(`${apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
  }
}

if (!foundMessageId) {
  console.error('Message not found in recent updates');
  process.exit(1);
}

const delUrl = `${apiUrl}/deleteMessage`;
const delRes = await fetch(delUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: Number(chatId), message_id: foundMessageId }),
});
const delData = await delRes.json();
if (!delData.ok) {
  console.error(`Telegram error: ${delData.description}`);
  process.exit(1);
}
console.log('Message deleted');
process.exit(0);

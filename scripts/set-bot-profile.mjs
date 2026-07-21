#!/usr/bin/env node
/**
 * Sets the bot's public profile (description, short description, command list)
 * via the Bot API directly — no BotFather interaction needed.
 *
 * Usage: TELEGRAM_BOT_TOKEN=... node scripts/set-bot-profile.mjs
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const shortDescription =
  "Бот-модератор чатов: чистит мат и спам, гибкие настройки и панель управления через Mini App.";

const description = `Добавьте меня в группу администратором — буду автоматически удалять нецензурную лексику и рекламный спам (ссылки на посторонние каналы/боты, «пишите в ЛС», флуд).

Есть бесплатный базовый фильтр и опциональный премиум-режим на ИИ (Groq) для спорных случаев. Все настройки — через команды в чате или через панель управления (Mini App): фильтры, действие при нарушении, белый список, свои слова, журнал удалений, статистика.

/help — список команд.`;

const commands = [
  { command: "start", description: "Начать работу с ботом" },
  { command: "help", description: "Список команд" },
  { command: "panel", description: "Открыть панель управления (Mini App)" },
  { command: "settings", description: "Текущие настройки группы" },
  { command: "premium", description: "ИИ-модерация: on/off" },
  { command: "filter_profanity", description: "Фильтр мата: on/off" },
  { command: "antispam", description: "Антиспам: on/off" },
  { command: "action", description: "Действие: delete/warn/mute/ban" },
  { command: "whitelist", description: "Белый список: add/remove" },
  { command: "customwords", description: "Свои слова для фильтра" },
  { command: "welcome", description: "Приветственное сообщение" },
  { command: "logchannel", description: "Канал-журнал удалений" },
  { command: "stats", description: "Статистика: today/7d/30d" },
  { command: "lang", description: "Язык уведомлений группы: ru/uz" },
];

const results = await Promise.all([
  api("setMyShortDescription", { short_description: shortDescription, language_code: "ru" }),
  api("setMyDescription", { description, language_code: "ru" }),
  api("setMyCommands", { commands, language_code: "ru" }),
]);

for (const [i, name] of ["setMyShortDescription", "setMyDescription", "setMyCommands"].entries()) {
  console.log(name, results[i].ok ? "OK" : `FAILED: ${results[i].description}`);
}

if (results.some((r) => !r.ok)) process.exit(1);

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

// Kept in sync with the actual command handlers in lib/telegram/commands.ts —
// this list previously missed captcha/antiraid/upgrade/plan/preset entirely,
// so those commands (upgrade being the only in-chat monetization path) never
// showed up in Telegram's "/" autocomplete even though they worked fine.
const commandsRu = [
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
  { command: "captcha", description: "Капча для новых участников: on/off (PRO)" },
  { command: "antiraid", description: "Антирейд-защита: on/off (PRO)" },
  { command: "federation", description: "Общий бан-лист с другими группами: on/off (PRO)" },
  { command: "stats", description: "Статистика: today/7d/30d" },
  { command: "plan", description: "Статус тарифа" },
  { command: "upgrade", description: "Оформить PRO-тариф" },
  { command: "preset", description: "Набор слов под отрасль" },
  { command: "lang", description: "Язык уведомлений группы: ru/uz" },
];

const commandsUz = [
  { command: "start", description: "Бот билан ишлашни бошлаш" },
  { command: "help", description: "Буйруқлар рўйхати" },
  { command: "panel", description: "Бошқарув панелини очиш (Mini App)" },
  { command: "settings", description: "Гуруҳнинг жорий созламалари" },
  { command: "premium", description: "Сунъий интеллект модерацияси: on/off" },
  { command: "filter_profanity", description: "Сўкиниш фильтри: on/off" },
  { command: "antispam", description: "Антиспам: on/off" },
  { command: "action", description: "Чора: delete/warn/mute/ban" },
  { command: "whitelist", description: "Оқ рўйхат: add/remove" },
  { command: "customwords", description: "Фильтр учун ўз сўзлари" },
  { command: "welcome", description: "Хуш келибсиз хабари" },
  { command: "logchannel", description: "Ўчиришлар журнали канали" },
  { command: "captcha", description: "Янги аъзолар учун капча: on/off (PRO)" },
  { command: "antiraid", description: "Антирейд-ҳимоя: on/off (PRO)" },
  { command: "federation", description: "Бошқа гуруҳлар билан умумий бан-рўйхати: on/off (PRO)" },
  { command: "stats", description: "Статистика: today/7d/30d" },
  { command: "plan", description: "Тариф ҳолати" },
  { command: "upgrade", description: "PRO тарифни расмийлаштириш" },
  { command: "preset", description: "Соҳа учун сўзлар тўплами" },
  { command: "lang", description: "Гуруҳ хабарномалари тили: ru/uz" },
];

const results = await Promise.all([
  api("setMyShortDescription", { short_description: shortDescription, language_code: "ru" }),
  api("setMyDescription", { description, language_code: "ru" }),
  // language_code: "ru" only covers clients whose Telegram UI language is
  // Russian — everyone else (Uzbek, English, ...) falls back to whichever
  // list has no language_code at all. Without that default, a non-ru client
  // saw an EMPTY "/" menu no matter how many commands actually worked.
  api("setMyCommands", { commands: commandsRu, language_code: "ru" }),
  api("setMyCommands", { commands: commandsUz, language_code: "uz" }),
  api("setMyCommands", { commands: commandsRu }),
]);

const labels = [
  "setMyShortDescription",
  "setMyDescription",
  "setMyCommands (ru)",
  "setMyCommands (uz)",
  "setMyCommands (default)",
];
for (const [i, name] of labels.entries()) {
  console.log(name, results[i].ok ? "OK" : `FAILED: ${results[i].description}`);
}

if (results.some((r) => !r.ok)) process.exit(1);

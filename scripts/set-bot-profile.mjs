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

// Display name (BotFather /setname). Kept in sync BY HAND with SITE_NAME in
// lib/seo.ts — this is a plain .mjs script and can't import the TS module.
//
// ⚠️ setMyName is heavily rate-limited by Telegram: the name is effectively a
// one-shot choice, not something to A/B test (GROWTH.md §0, §6 decision 2).
// GROWTH.md §1.2 recommends the keyword-first variant
// "Антиспам TOVUS — мат, реклама, APK"; the owner chose the brand-first form
// below. Changing this line changes the bot's public name on the next run.
const name = "TOVUS | Антиспам";

const shortDescription =
  "Бот-модератор чатов: чистит мат и спам, гибкие настройки и панель управления через Mini App.";

const description = `Добавьте меня в группу администратором — буду автоматически удалять нецензурную лексику и рекламный спам (ссылки на посторонние каналы/боты, «пишите в ЛС», флуд).

Есть бесплатный базовый фильтр и опциональный премиум-режим на ИИ (DeepSeek) для спорных случаев. Все настройки — через команды в чате или через панель управления (Mini App): фильтры, действие при нарушении, белый список, свои слова, журнал удалений, статистика.

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
  { command: "cascheck", description: "Проверка новых участников по базе CAS: on/off" },
  { command: "restrictnewmembers", description: "Ограничить новых участников: on/off" },
  { command: "restrictminutes", description: "Длительность ограничения новичков: 1-1440 мин" },
  { command: "nightmode", description: "Тихий час: on/off" },
  { command: "nighthours", description: "Часы тихого часа: <начало> <конец> (0-23, UTC)" },
  { command: "action", description: "Действие: delete/warn/mute/ban" },
  { command: "warnlimit", description: "Эскалация после N предупреждений: 0-20 (0=выкл)" },
  { command: "warnaction", description: "Действие при лимите предупреждений: mute/ban" },
  { command: "votebanthreshold", description: "Голосов участников для автоснятия мута/бана: 1-50" },
  { command: "whitelist", description: "Белый список: add/remove" },
  { command: "customwords", description: "Свои слова для фильтра" },
  { command: "spam", description: "Ответом: пометить как спам для обучения фильтра" },
  { command: "ham", description: "Ответом: пометить как не спам для обучения фильтра" },
  { command: "welcome", description: "Приветственное сообщение" },
  { command: "logchannel", description: "Канал-журнал удалений" },
  { command: "captcha", description: "Капча для новых участников: on/off (PRO)" },
  { command: "captchatype", description: "Тип капчи: button/math/rules" },
  { command: "captchatimeout", description: "Время на прохождение капчи: 30-600 сек (PRO)" },
  { command: "rulestext", description: "Текст правил для капчи типа rules" },
  { command: "antiraid", description: "Антирейд-защита: on/off (PRO)" },
  { command: "federation", description: "Общий бан-лист с другими группами: on/off (PRO)" },
  { command: "stats", description: "Статистика: today/7d/30d" },
  { command: "plan", description: "Статус тарифа" },
  { command: "upgrade", description: "Оформить PRO-тариф" },
  { command: "invite", description: "Реферальная ссылка: 3 группы = месяц PRO" },
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
  { command: "cascheck", description: "CAS базаси орқали янги аъзоларни текшириш: on/off" },
  { command: "restrictnewmembers", description: "Янги аъзоларни чеклаш: on/off" },
  { command: "restrictminutes", description: "Янгиларни чеклаш давомийлиги: 1-1440 дақ" },
  { command: "nightmode", description: "Сокин соат: on/off" },
  { command: "nighthours", description: "Сокин соат вақти: <бошланиш> <тугаш> (0-23, UTC)" },
  { command: "action", description: "Чора: delete/warn/mute/ban" },
  { command: "warnlimit", description: "N огоҳлантиришдан кейин эскалация: 0-20 (0=ўчирилган)" },
  { command: "warnaction", description: "Огоҳлантириш лимитида чора: mute/ban" },
  { command: "votebanthreshold", description: "Мут/банни автобекор қилиш учун овозлар: 1-50" },
  { command: "whitelist", description: "Оқ рўйхат: add/remove" },
  { command: "customwords", description: "Фильтр учун ўз сўзлари" },
  { command: "spam", description: "Жавобан: фильтрни ўргатиш учун спам деб белгилаш" },
  { command: "ham", description: "Жавобан: фильтрни ўргатиш учун спам эмас деб белгилаш" },
  { command: "welcome", description: "Хуш келибсиз хабари" },
  { command: "logchannel", description: "Ўчиришлар журнали канали" },
  { command: "captcha", description: "Янги аъзолар учун капча: on/off (PRO)" },
  { command: "captchatype", description: "Капча тури: button/math/rules" },
  { command: "captchatimeout", description: "Капчани ўтиш вақти: 30-600 сония (PRO)" },
  { command: "rulestext", description: "rules капча тури учун қоидалар матни" },
  { command: "antiraid", description: "Антирейд-ҳимоя: on/off (PRO)" },
  { command: "federation", description: "Бошқа гуруҳлар билан умумий бан-рўйхати: on/off (PRO)" },
  { command: "stats", description: "Статистика: today/7d/30d" },
  { command: "plan", description: "Тариф ҳолати" },
  { command: "upgrade", description: "PRO тарифни расмийлаштириш" },
  { command: "invite", description: "Реферал ҳавола: 3 гуруҳ = 1 ой PRO" },
  { command: "preset", description: "Соҳа учун сўзлар тўплами" },
  { command: "lang", description: "Гуруҳ хабарномалари тили: ru/uz" },
];

const results = await Promise.all([
  // No language_code: the name is identical in both locales, and setMyName is
  // rate-limited hard enough that per-language calls would only triple the
  // chance of a throttle. A throttled setMyName makes this whole script exit 1
  // even when the descriptions and command lists all landed — check the
  // per-call lines below before assuming nothing was applied.
  api("setMyName", { name }),
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
  "setMyName",
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

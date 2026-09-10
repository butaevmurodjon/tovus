# Модератор — Telegram-бот + admin Mini App

Бот-модератор для Telegram-групп (grammY, webhook на Vercel) с панелью
управления в виде Telegram Mini App (Next.js App Router). Один Next.js-проект
хостит и то, и другое: `/api/telegram/webhook` — вебхук бота, остальные роуты
— Mini App.

Локализация: только русский и узбекский (кириллица), светлый дизайн
зафиксирован (не зависит от темы Telegram/ОС).

## Структура

- `lib/moderation/*` — фильтр мата (regex с учётом обхода через замену
  букв/цифр), антиспам-эвристики, флуд-детект, интеграция с DeepSeek (премиум)
- `lib/db/*` — Upstash Redis: настройки групп, whitelist, статистика, журнал
- `lib/telegram/*` — сам бот (grammY), команды, проверка initData Mini App,
  проверка админ-прав через `getChatMember`
- `lib/i18n/*` — словари `ru` / `uz`, общие для бота и Mini App
- `app/api/telegram/webhook` — вебхук бота
- `app/api/miniapp/*` — API для Mini App (авторизация через initData)
- `app/`, `components/`, `contexts/` — сам Mini App (Next.js App Router)

## Настройка

1. Скопируйте `.env.example` → `.env.local` и заполните:
   - `TELEGRAM_BOT_TOKEN` — от [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_BOT_USERNAME` — username бота без `@`
   - `TELEGRAM_WEBHOOK_SECRET` — любая случайная строка
   - `TELEGRAM_MINI_APP_URL` — публичный URL деплоя (после первого `vercel deploy`)
   - `DEEPSEEK_API_KEY` — с [platform.deepseek.com](https://platform.deepseek.com);
     используется только когда в группе включён премиум-режим
2. Поднимите Upstash Redis через Vercel Marketplace: `vercel integration add upstash`
   (создаст `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` автоматически).
3. `vercel env pull .env.local` чтобы синхронизировать переменные локально.
4. Задеплойте: `vercel deploy` (или `vercel --prod`).
5. Зарегистрируйте вебхук:
   ```bash
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
     node scripts/set-webhook.mjs https://your-app.vercel.app
   ```
6. В BotFather: `/setmenubutton` → укажите `TELEGRAM_MINI_APP_URL` как web_app
   кнопку меню бота (открывается в личном чате).
7. Добавьте бота в группу администратором с правами удаления сообщений и
   блокировки участников.

## Права бота в группе

- Delete messages
- Ban users
- (для mute) Restrict members

## Команды бота

Источник истины — `lib/telegram/commands.ts`; список для автодополнения
Telegram (`setMyCommands`) живёт в `scripts/set-bot-profile.mjs`. Кроме
`/start`, `/help`, `/panel`, `/plan` и `/stats` все команды требуют прав
администратора и работают только в группе. `(PRO)` — доступно на платном
тарифе (`/upgrade`).

**Базовое**

- `/start` — приветствие, в личке — кнопка открытия панели
- `/help` — список команд
- `/panel` — открыть панель управления (Mini App)
- `/settings` — текущие настройки группы + предупреждение о нехватке прав
- `/lang ru|uz` — язык уведомлений бота в группе

**Фильтры**

- `/filter_profanity on|off` — фильтр мата
- `/antispam on|off` — антиспам-эвристики
- `/premium on|off` — ИИ-разбор спорных случаев (DeepSeek)
- `/customwords add|remove|list <слово>` — свои слова/фразы поверх встроенного
  словаря (та же логика обхода через пробелы/символы)
- `/preset <набор>` — добавить готовый отраслевой набор слов

**Реакция на нарушение**

- `/action delete|warn|mute|ban` — что делать с нарушителем
- `/warnlimit <0-20>` — эскалация после N предупреждений (0 — выключить)
- `/warnaction mute|ban` — что делать при достижении лимита предупреждений
- `/votebanthreshold <1-50>` — сколько голосов нужно для голосового бана
- `/whitelist add|remove` — белый список (ответом на сообщение либо
  `@username`/id)

**Новые участники**

- `/cascheck on|off` — проверка новичков по базе CAS
- `/restrictnewmembers on|off` и `/restrictminutes <1-1440>` — ограничение
  новичков на первые N минут
- `/captcha on|off` (PRO, кроме типа `rules`) — проверка новичков
- `/captchatype button|math|rules` — тип проверки (`button`/`math` — PRO)
- `/captchatimeout <30-600>` (PRO) — время на прохождение
- `/rulestext <текст|off>` — текст правил для типа `rules`
- `/welcome <текст|off>` — приветственное сообщение

**Защита и режимы**

- `/antiraid on|off` (PRO) — антирейд-защита
- `/federation on|off` (PRO) — общий бан-лист с другими группами
- `/nightmode on|off` и `/nighthours <start> <end>` — ночной режим (часы 0-23)

**Журнал, статистика, тариф**

- `/logchannel <id|off>` — канал-журнал удалений (бот должен быть его админом)
- `/stats [today|7d|30d]` — статистика группы
- `/plan` — текущий тариф
- `/upgrade` — счёт на PRO (Telegram Stars)

**Обучение фильтра** (работает только при `CORPUS_ENABLED`, см. `PRIVACY.md`)

- `/spam` — ответом на сообщение: удалить и пометить как спам
- `/ham` — ответом на сообщение: пометить как «не спам»

Свои слова также редактируются в Mini App (Настройки группы → «Свои слова
для фильтра»).

## Локальная разработка

```bash
npm install
npm run dev
```

Mini App проверяет `initData` через HMAC — вне Telegram-клиента (обычный
браузер) API вернёт 401, экран покажет "откройте через кнопку в боте". Для
полноценного теста Mini App нужен реальный деплой + туннель (ngrok/Vercel
preview) и открытие через кнопку бота в Telegram.

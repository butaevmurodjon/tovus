# Модератор — Telegram-бот + admin Mini App

Бот-модератор для Telegram-групп (grammY, webhook на Vercel) с панелью
управления в виде Telegram Mini App (Next.js App Router). Один Next.js-проект
хостит и то, и другое: `/api/telegram/webhook` — вебхук бота, остальные роуты
— Mini App.

Локализация: только русский и узбекский (кириллица), светлый дизайн
зафиксирован (не зависит от темы Telegram/ОС).

## Структура

- `lib/moderation/*` — фильтр мата (regex с учётом обхода через замену
  букв/цифр), антиспам-эвристики, флуд-детект, интеграция с Groq (премиум)
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
   - `GROQ_API_KEY` — с [console.groq.com](https://console.groq.com) (бесплатный tier)
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

`/start`, `/help`, `/panel`, `/settings`, `/premium on|off`,
`/filter_profanity on|off`, `/antispam on|off`, `/action delete|warn|mute|ban`,
`/whitelist add|remove` (ответом на сообщение или `@username`/id),
`/customwords add|remove|list <слово>` — свои слова/фразы в фильтр мата,
поверх встроенного словаря (та же логика обхода через пробелы/символы),
`/logchannel <id|off>`, `/stats [today|7d|30d]`, `/lang ru|uz`.

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

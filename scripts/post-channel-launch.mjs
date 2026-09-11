#!/usr/bin/env node
/**
 * One-off: posts the first 4 launch messages to the promo channel
 * @tovus_antispam (RU + UZ-cyrl + EN in each post). Follows the same plain
 * fetch-to-Bot-API pattern as scripts/set-bot-profile.mjs.
 *
 * Usage: TELEGRAM_BOT_TOKEN=... node scripts/post-channel-launch.mjs
 *
 * Content grounded only in features actually live in production as of
 * 2026-09-11 (captcha/antiraid free, appeals, new 199⭐ price — confirmed via
 * a manual `vercel --prod` deploy earlier the same session) and real
 * aggregate stats pulled from production Redis the same day (6 groups, 1079
 * moderation actions/30d) — no invented numbers, no unshipped claims.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}

const CHANNEL = "@tovus_antispam";

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const posts = [
  // 1 — intro
  `🇷🇺 RU:
Представляем TOVUS | Антиспам — бота-модератора для Telegram-групп на русском и узбекском (кириллица).

Чищу мат, спам, рекламу, скам и вирусные .apk — включая те, что присылают цитатой из другого канала. В этом канале — новости, реальная статистика и советы по защите чата.

🇺🇿 UZ:
TOVUS | Антиспам — рус ва ўзбек (кирилл) тилидаги Telegram-гуруҳлар учун модератор-бот.

Сўкиниш, спам, реклама, фирибгарлик ва вирусли .apk файлларни — бошқа каналдан иқтибос қилиб юборилганларини ҳам — тозалайман. Бу каналда — янгиликлар, ҳақиқий статистика ва чатни ҳимоя қилиш бўйича маслаҳатлар.

🇬🇧 EN:
Meet TOVUS | Antispam — a moderator bot for Telegram groups in Russian and Uzbek (Cyrillic).

It removes profanity, spam, ads, scams, and malicious .apk files — including ones relayed in via a quote from another channel. This channel will carry updates, real usage stats, and group-safety tips.`,

  // 2 — differentiators
  `🇷🇺 RU:
Чем отличаемся от других модератор-ботов:

• Узбекский (кириллица) + русский — большинство ботов такого не умеют
• Ловим вирусные .apk, даже если их прислали цитатой из чужого канала — редкая и опасная схема мошенников
• Панель управления — прямо в Telegram (Mini App), без сторонних сайтов
• Журнал удалений с восстановлением сообщения одним нажатием
• ИИ-модерация (DeepSeek) для спорных случаев

🇺🇿 UZ:
Бошқа модератор-ботлардан фарқимиз:

• Ўзбек (кирилл) + рус тиллари — ботларнинг кўпчилиги буни билмайди
• Бошқа каналдан иқтибос қилиб юборилган вирусли .apk файлларни ҳам аниқлаймиз — фирибгарларнинг кам учрайдиган, лекин хавфли усули
• Бошқарув панели — тўғридан-тўғри Telegram ичида (Mini App), ташқи сайтларсиз
• Ўчирилганлар журнали — бир босишда хабарни қайтариш имконияти билан
• Мураккаб ҳолатлар учун сунъий интеллект модерацияси (DeepSeek)

🇬🇧 EN:
What sets us apart from other moderator bots:

• Uzbek (Cyrillic) + Russian — most moderator bots don't cover this
• Catches malicious .apk files even when relayed via a quote from another channel — a rare but dangerous scam vector
• Control panel lives inside Telegram itself (Mini App) — no external website
• A deletion journal with one-tap restore for any removed message
• AI-assisted moderation (DeepSeek) for edge cases`,

  // 3 — real stats
  `🇷🇺 RU:
Цифры за последние 30 дней: бот уже защищает 6 групп и обработал 1 079 нарушений — 420 случаев мата, 204 спам-сообщения, 455 решений ИИ-модерации по спорным случаям.

Мы только начинаем — буду делиться цифрами регулярно, по мере роста.

🇺🇿 UZ:
Сўнгги 30 кундаги рақамлар: бот аллақачон 6 та гуруҳни ҳимоя қиляпти ва 1 079 та қоидабузарликни аниқлади — 420 та сўкиниш, 204 та спам, 455 та сунъий интеллект қарори (мунозарали ҳолатлар бўйича).

Биз энди бошладик — ўсиб борган сайин рақамларни мунтазам баham кўраман.

🇬🇧 EN:
Last 30 days: the bot is already protecting 6 groups and has handled 1,079 moderation actions — 420 profanity hits, 204 spam messages, and 455 AI-moderation calls on edge cases.

Early days — I'll share these numbers regularly as it grows.`,

  // 4 — CTA + free tier + price
  `🇷🇺 RU:
Базовая защита бесплатна навсегда: мат, спам, анти-скам, CAS, капча и антирейд — для групп любого размера. PRO (ИИ-модерация, общий бан-лист, аналитика) — 199 ⭐/мес.

Добавить бота: https://t.me/TovusBot?startgroup=true

🇺🇿 UZ:
Асосий ҳимоя абадий бепул: сўкиниш, спам, анти-скам, CAS, капча ва антирейд — ҳар қандай ҳажмдаги гуруҳлар учун. PRO (сунъий интеллект, умумий бан-рўйхати, аналитика) — ойига 199 ⭐.

Ботни қўшиш: https://t.me/TovusBot?startgroup=true

🇬🇧 EN:
Core protection is free forever: profanity filter, spam/anti-scam, CAS, captcha, and antiraid — for groups of any size. PRO (AI moderation, shared ban-list, analytics) is 199 ⭐/mo.

Add the bot: https://t.me/TovusBot?startgroup=true`,
];

for (let i = 0; i < posts.length; i++) {
  const res = await api("sendMessage", {
    chat_id: CHANNEL,
    text: posts[i],
    disable_web_page_preview: true,
  });
  if (!res.ok) {
    console.error(`Post ${i + 1}/${posts.length} FAILED:`, res.description ?? res);
    process.exit(1);
  }
  console.log(`Post ${i + 1}/${posts.length} sent — message_id ${res.result.message_id}`);
  if (i < posts.length - 1) await new Promise((r) => setTimeout(r, 2000));
}

console.log("All posts sent.");

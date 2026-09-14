#!/usr/bin/env node
/**
 * Re-launch of the promo channel content, replacing the first cut from
 * commit 1a520d0. That version stacked RU+UZ+EN as one undifferentiated
 * plain-text wall per message — no bold, no bullets, no CTA button — which
 * read as a dump, not a channel. This version:
 *
 *   - uses parse_mode "HTML" (bold section headers, bullet lists) instead of
 *     plain text
 *   - keeps RU+UZ (the bot's actual product languages) in full per post;
 *     drops the full EN paragraph per post — EN gets one tagline, once, in
 *     the pinned "about" post only (owner's call, 2026-09-11: tripling every
 *     post for a market that isn't the target audience was most of the bulk)
 *   - attaches an inline "🛡 Add bot to group" button to every post
 *     (reply_markup), so the CTA is a tap, not a copy-pasted link in text
 *   - also sets the channel's About/description via setChatDescription —
 *     it was never set at all
 *
 * Content grounded the same way as before: only features actually live in
 * production, and the real 30-day stats pulled from production Redis on
 * 2026-09-11 (6 groups, 1079 moderation actions) — no invented numbers.
 *
 * 2026-09-14: added posts 5-6 (install guide, settings/features map) after
 * reviewing @lolsAntiSpam's two Telegraph posts (install guide + settings
 * menu) for gaps — see inline comments on those two posts for what was
 * kept, trimmed, or skipped.
 *
 * IMPORTANT — before running this: delete the 4 old plain-text posts in
 * @tovus_antispam manually (long-press → Delete in the Telegram app). The
 * Bot API has no "list channel messages" call, and the old script never
 * persisted the message_ids it printed at send time, so this script can't
 * find and delete them itself.
 *
 * Usage: TELEGRAM_BOT_TOKEN=... node scripts/post-channel-launch.mjs
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN in env.");
  process.exit(1);
}

const CHANNEL = "@tovus_antispam";
const ADD_BOT_URL = "https://t.me/TovusBot?startgroup=true";

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const addBotButton = {
  inline_keyboard: [[{ text: "🛡 Добавить бота в группу", url: ADD_BOT_URL }]],
};

const description =
  "Бот-модератор для Telegram-групп на русском и узбекском (кириллица): мат, спам, скам, вирусные APK — под контролем. Капча и антирейд бесплатно. Добавить: t.me/TovusBot?startgroup=true";

const posts = [
  // 1 — pinned "about" post. The only one carrying an EN line, and only a
  // one-line tagline, not a full paragraph.
  `<b>🛡 TOVUS | Антиспам</b>

Бот-модератор для Telegram-групп на русском и узбекском (кириллица).

▪️ Чистит мат, спам, рекламу и скам
▪️ Ловит вирусные .apk — даже присланные цитатой из другого канала
▪️ Капча и антирейд — бесплатно для групп любого размера
▪️ Управление прямо в Telegram (Mini App), без сторонних сайтов

<b>🇺🇿 O'zbekcha</b>

Rus va o'zbek (kirill) tilidagi guruhlar uchun moderator-bot.

▪️ So'kinish, spam, reklama va firibgarlikni tozalaydi
▪️ Boshqa kanaldan iqtibos qilib yuborilgan virusli .apk fayllarni ham aniqlaydi
▪️ Kapcha va antireyd — istalgan hajmdagi guruhlar uchun bepul
▪️ Boshqaruv — to'g'ridan-to'g'ri Telegram ichida (Mini App)

<i>🇬🇧 A moderator bot for Russian &amp; Uzbek (Cyrillic) Telegram groups — spam, profanity, scams and malicious files, gone.</i>`,

  // 2 — differentiators
  `<b>⚡️ Чем отличаемся от других ботов</b>

▪️ Узбекский (кириллица) + русский — редкость среди модератор-ботов
▪️ Ловим .apk-скам, даже присланный цитатой из чужого канала
▪️ Панель управления — Mini App внутри Telegram, без сторонних сайтов
▪️ Журнал удалений с восстановлением сообщения в один клик
▪️ ИИ-модерация (DeepSeek) для спорных случаев

<b>🇺🇿 Boshqa botlardan farqimiz</b>

▪️ O'zbek (kirill) + rus tili — bunday botlar kam
▪️ Boshqa kanaldan iqtibos qilingan .apk-skamni ham tutamiz
▪️ Boshqaruv paneli — Telegram ichidagi Mini App
▪️ O'chirilganlar jurnali — bir bosishda qaytarish
▪️ Murakkab holatlar uchun sun'iy intellekt (DeepSeek)`,

  // 3 — real stats
  `<b>📊 Цифры за 30 дней</b>

🛡 6 групп под защитой
⚔️ 1 079 нарушений обработано
🤬 420 — мат
🚫 204 — спам
🤖 455 — решений ИИ-модерации по спорным случаям

Мы только начинаем — буду делиться цифрами регулярно, по мере роста.

<b>🇺🇿 30 kunlik statistika</b>

🛡 6 ta guruh himoyada
⚔️ 1 079 ta qoidabuzarlik aniqlandi
🤬 420 — so'kinish
🚫 204 — spam
🤖 455 — sun'iy intellekt qarori

Endi boshladik — o'sib borgan sari raqamlarni muntazam baham ko'raman.`,

  // 4 — pricing + CTA
  `<b>💳 Тарифы</b>

Бесплатно навсегда: мат-фильтр, антиспам, анти-скам, CAS, капча, антирейд — для групп любого размера.

PRO — 199 ⭐/мес: ИИ-модерация, общий бан-лист, аналитика.

<b>🇺🇿 Tariflar</b>

Abadiy bepul: so'kinish filtri, antispam, anti-skam, CAS, kapcha, antireyd — istalgan hajmdagi guruhlar uchun.

PRO — oyiga 199 ⭐: sun'iy intellekt, umumiy ban-ro'yxati, analitika.`,

  // 5 — install guide. Modelled on @lolsAntiSpam's Telegraph install post
  // (t.me/lolsAntiSpam's "как добавить бота" page) but trimmed to a channel
  // post: same "which rights, minimum required" structure, no screenshot
  // (we don't have one staged), no counterfeit-bot warning (not a problem
  // we have — @TovusBot has no known impersonators).
  `<b>🚀 Как добавить бота</b>

1. Группа → Управление группой → Администраторы → Добавить администратора
2. Найти @TovusBot → выдать права
3. Минимум нужно: <b>Удаление сообщений</b> и <b>Ограничение участников</b> — без них модерация и капча не сработают

После добавления бот сам напишет в группу. Донастройка — через Mini App, отдельный сайт не нужен.

<b>🇺🇿 Botni qanday qo'shish kerak</b>

1. Guruh → Guruhni boshqarish → Administratorlar → Administrator qo'shish
2. @TovusBot ni toping → huquqlarni bering
3. Kamida kerak: <b>Xabarlarni o'chirish</b> va <b>A'zolarni cheklash</b> — bularsiz moderatsiya va kapcha ishlamaydi

Qo'shgandan keyin bot guruhga o'zi yozadi. Qo'shimcha sozlash — Mini App orqali, alohida sayt shart emas.`,

  // 6 — settings/features map. Modelled on @lolsAntiSpam's Telegraph
  // "Главное меню" settings index, but collapsed: Lols links out to ~9
  // separate Telegraph sub-pages because its own config lives across many
  // bot-command screens; we have one Mini App screen for all of it, so this
  // is a single post describing sections, not a tree of links. The "Важно
  // знать" bullets mirror Lols' honesty about bot-native limits (history,
  // other bots, hard deletes) — trimmed from Lols' ~7 to the 3 that are
  // actually true for us and actually change what an admin expects.
  `<b>⚙️ Что можно настроить</b>

Всё в одном месте — Mini App внутри Telegram, без внешних сайтов и паролей:

🛡 <b>Защита</b> — мат, спам, скам, CAS, ИИ-модерация (PRO), тихий час, сервисные сообщения
👤 <b>Новые участники</b> — капча, антирейд, временное ограничение прав
⚖️ <b>Наказания</b> — предупреждения с эскалацией, голосование за снятие
📖 <b>Вайтлист</b> — свои слова и ссылки, которые никогда не банятся
📊 <b>Журнал</b> — что и почему удалено, восстановление в один клик
🔔 <b>Канал-лог</b> — дублировать действия бота в отдельный канал

<b>Важно знать:</b>
▪️ Бот видит только сообщения после добавления — историю до этого не читает
▪️ Не координируется с другими ботами-модераторами в чате
▪️ «Восстановить» в журнале — это заново отправить текст: Telegram не даёт отменить само удаление

<b>🇺🇿 Nimalarni sozlash mumkin</b>

Hammasi bitta joyda — Telegram ichidagi Mini App, tashqi sayt va parolsiz:

🛡 <b>Himoya</b> — so'kinish, spam, skam, CAS, sun'iy intellekt (PRO), tungi rejim, servis xabarlari
👤 <b>Yangi a'zolar</b> — kapcha, antireyd, vaqtinchalik huquq cheklash
⚖️ <b>Jazolar</b> — bosqichma-bosqich ogohlantirish, bekor qilish uchun ovoz berish
📖 <b>Oq ro'yxat</b> — hech qachon ban qilinmaydigan so'z va havolalar
📊 <b>Jurnal</b> — nima va nega o'chirilgani, bir bosishda qaytarish
🔔 <b>Kanal-jurnal</b> — bot harakatlarini alohida kanalga dublikatlash

<b>Bilib qo'ying:</b>
▪️ Bot faqat qo'shilgandan keyingi xabarlarni ko'radi — avvalgi tarixni o'qimaydi
▪️ Chatdagi boshqa moderator-botlar bilan bog'lanmaydi
▪️ Jurnaldagi «Qaytarish» — matnni qayta yuborish: Telegram o'chirishning o'zini bekor qilishga imkon bermaydi`,
];

const descRes = await api("setChatDescription", { chat_id: CHANNEL, description });
if (!descRes.ok) {
  console.error("setChatDescription FAILED:", descRes.description ?? descRes);
  // Not fatal — keep going and post content even if the description couldn't be set.
} else {
  console.log("Channel description set.");
}

let pinnedMessageId = null;
for (let i = 0; i < posts.length; i++) {
  const res = await api("sendMessage", {
    chat_id: CHANNEL,
    text: posts[i],
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: addBotButton,
  });
  if (!res.ok) {
    console.error(`Post ${i + 1}/${posts.length} FAILED:`, res.description ?? res);
    process.exit(1);
  }
  console.log(`Post ${i + 1}/${posts.length} sent — message_id ${res.result.message_id}`);
  if (i === 0) pinnedMessageId = res.result.message_id;
  if (i < posts.length - 1) await new Promise((r) => setTimeout(r, 2000));
}

if (pinnedMessageId) {
  const pinRes = await api("pinChatMessage", {
    chat_id: CHANNEL,
    message_id: pinnedMessageId,
    disable_notification: true,
  });
  if (!pinRes.ok) {
    console.error("pinChatMessage FAILED (not fatal):", pinRes.description ?? pinRes);
  } else {
    console.log("Pinned the 'about' post.");
  }
}

console.log("All posts sent.");

export const LINK_COUNT_THRESHOLD = 2;
export const MENTION_COUNT_THRESHOLD = 4;

/** Domains that are near-always used for ad spam / scam funnels in group chats. Extend freely. */
export const DOMAIN_BLACKLIST: string[] = [
  "bit.ly",
  "tinyurl.com",
  "clck.ru",
  "cutt.ly",
  "vk.cc",
  "is.gd",
  "shorturl.at",
  "t.ly",
  "rebrand.ly",
  "ow.ly",
  "buff.ly",
  "qps.ru",
  "goo.gl",
  "v.gd",
  "s.id",
  "trib.al",
];

/** Call-to-action phrases commonly paired with forwarded ads / DM-bait, ru + uz-cyrl. */
export const CTA_PHRASES: string[] = [
  "пиши в лс",
  "пишите в лс",
  "пиши в личку",
  "пишите в личку",
  "пиши в директ",
  "жми сюда",
  "переходи по ссылке",
  "подпишись на канал",
  "заработок в интернете",
  "заработок от",
  "быстрый доход",
  "инвестиции от",
  "удаленная работа от",
  "набор в команду",
  "хочешь заработать",
  "шёпотом в лс",
  "менга ёзинг",
  "лс га ёзинг",
  "хусусийга ёзинг",
  "каналга обуна бўлинг",
  "тез орада даромад",
  "уйдан ишлаш",
  "жамоага қабул",
  // Fake "official bank/gov app" installer pitch — the social-engineering line that
  // usually accompanies a scam .apk, ru + uz-cyrl.
  "скачайте официальное приложение",
  "скачать официальное приложение",
  "обновите приложение банка",
  "обновление банковского приложения",
  "установите обновление",
  "новая версия приложения по ссылке",
  "расмий иловани юклаб олинг",
  "иловани янгиланг",
  "банк иловасини янгиланг",
];

/**
 * File extensions almost never legitimate in a public/business group chat and
 * heavily used for malware/spyware distribution in the region — fake "official
 * bank/gov app" .apk installers are the single most common scam-file vector here.
 * Matched case-insensitively against the sender-supplied file name.
 */
export const DANGEROUS_FILE_EXTENSIONS: string[] = [
  "apk",
  "apks",
  "xapk",
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "vbs",
  "vbe",
  "wsf",
  "jar",
  "ps1",
  "deb",
  "dmg",
  "pkg",
];

/** MIME types cross-checked in case the extension was stripped/renamed. */
export const DANGEROUS_MIME_TYPES: string[] = [
  "application/vnd.android.package-archive",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-ms-installer",
  "application/x-sh",
  "application/java-archive",
];

export const FLOOD_MAX_MESSAGES = 5;
export const FLOOD_WINDOW_SECONDS = 10;
export const DUPLICATE_MAX_COUNT = 3;
export const DUPLICATE_WINDOW_SECONDS = 300;

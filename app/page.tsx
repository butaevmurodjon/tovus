import type { Metadata } from "next";
import Link from "next/link";
import { TelegramBounce } from "@/components/TelegramBounce";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/seo";

/**
 * The public marketing landing page (GROWTH.md §3.3). Deliberately a Server
 * Component with no `"use client"`: until this page existed, `/` was the
 * client-only Mini App shell and a crawler saw an empty div — SEO was exactly
 * zero. Everything below must therefore stay renderable on the server; the
 * single client island is <TelegramBounce />, which carries no visible UI.
 *
 * The Mini App now lives at `/app`. Do not reintroduce any Telegram detection
 * here beyond TelegramBounce — see the long note in that file for why
 * server-side sniffing is impossible, not merely discouraged.
 */

/**
 * Built at build time, not per request: this is a Server Component that gets
 * statically prerendered, so whatever `TELEGRAM_BOT_USERNAME` holds during
 * `next build` is baked into the HTML. If the variable is absent from the
 * build environment the CTA is omitted entirely rather than rendered broken —
 * same contract as `addToGroupUrl()` in lib/telegram/commands.ts, which this
 * intentionally duplicates instead of importing (importing that module would
 * drag grammY and the Redis client into the landing page's graph).
 */
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;
const ADD_TO_GROUP_URL = BOT_USERNAME
  ? `https://t.me/${BOT_USERNAME}?startgroup=true&admin=delete_messages+restrict_members`
  : null;
const BOT_URL = BOT_USERNAME ? `https://t.me/${BOT_USERNAME}` : null;

const TAGLINE_UZ =
  "Чатни сўкиниш, реклама ва вирусли .apk файллардан тозалайди — рус ва ўзбек тилларида.";

/**
 * `app/layout.tsx` already declares `alternates.canonical: "/"`, and its
 * TITLE_DEFAULT/description were written for exactly this page — so title and
 * OG are inherited on purpose. The canonical is restated anyway because the
 * layout's own comment warns that inheritance here is silent and untested:
 * spelling it out on the page it belongs to is what keeps a future
 * `alternates` edit in the layout from quietly re-pointing this URL.
 *
 * Do NOT add a plain `title` string here — the layout's title template would
 * wrap it into "… — TOVUS | Антиспам". Use `title: { absolute: … }` if a
 * distinct landing title is ever wanted.
 */
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
};

type Feature = { icon: string; title: string; body: string };

const FEATURES: Feature[] = [
  {
    icon: "🤬",
    title: "Мат и оскорбления — вместе с обходами",
    body:
      "Ловит не только словарь, но и попытки его обойти: звёздочки, цифры вместо букв, " +
      "пробелы внутри слова, латиница вместо кириллицы. Плюс свои слова и готовые " +
      "отраслевые наборы.",
  },
  {
    icon: "📢",
    title: "Реклама и спам",
    body:
      "Антиспам-эвристики против чужих каналов, приглашений, «пишите в ЛС», ссылок " +
      "и флуда — включая рекламу, прилетевшую цитатой из другого чата.",
  },
  {
    icon: "📦",
    title: "Вирусные .apk и .exe",
    body:
      "Фейковые «приложения банка» и «госуслуг» удаляются вместе с сообщением — " +
      "в том числе когда установщик процитирован из чужого канала, а не прикреплён напрямую.",
  },
  {
    icon: "🛂",
    title: "Проверка новичков по CAS",
    body:
      "Каждый вошедший сверяется с публичной базой забаненных спамеров Combot Anti-Spam. " +
      "Известный спамер не успевает написать первое сообщение.",
  },
  {
    icon: "🧠",
    title: "ИИ-разбор спорных случаев",
    body:
      "Пограничные сообщения, которые правилам не по зубам, уходят в DeepSeek — " +
      "в группах с включённым премиум-режимом. Остальное решается локально и бесплатно.",
  },
  {
    icon: "📱",
    title: "Панель прямо внутри Telegram",
    body:
      "Настройки, статистика и журнал удалений — в Mini App, без сайтов и паролей. " +
      "Каждое удаление видно с причиной, и любое можно вернуть одной кнопкой.",
  },
];

type Step = { title: string; body: string };

const STEPS: Step[] = [
  {
    title: "Добавьте бота в группу",
    body: "Кнопка ниже открывает список ваших чатов — выберите нужный.",
  },
  {
    title: "Оставьте отмеченными права",
    body:
      "«Удаление сообщений» и «Блокировка участников». Telegram предложит их сам; " +
      "без них бот честно предупредит в чате, что работать не сможет.",
  },
  {
    title: "Готово",
    body:
      "Чат чистится сразу, с настройками по умолчанию. Тонкая настройка — команда " +
      "/panel или кнопка меню бота.",
  },
];

/**
 * SINGLE source for both the visible FAQ and the FAQPage JSON-LD below.
 * Google drops structured data whose answers do not match the rendered text,
 * so these must never be written twice (GROWTH.md §3.3).
 */
type Faq = { q: string; a: string };

const FAQ: Faq[] = [
  {
    q: "Сколько это стоит?",
    a:
      "Фильтр мата, антиспам, удаление опасных файлов, проверка по CAS и журнал удалений — " +
      "бесплатно и без ограничения по времени. Капча, антирейд и общий бан-лист бесплатны " +
      "для групп до 200 участников; для чатов крупнее это тариф PRO — 349 Telegram Stars " +
      "в месяц (примерно $5), оплата прямо в Telegram.",
  },
  {
    q: "Какие права нужны боту?",
    a:
      "Два: «Удаление сообщений» — нужно для любого действия, и «Блокировка участников» — " +
      "для мута, бана и капчи. Больше ничего бот не просит. Если права выданы не полностью, " +
      "он напишет в чат, чего именно не хватает.",
  },
  {
    q: "Работает ли бот на узбекском?",
    a:
      "Да. Интерфейс панели и все уведомления есть на русском и на узбекском (кириллица), " +
      "язык группы переключается командой /lang ru|uz. Фильтры разбирают оба языка, " +
      "а не только русский.",
  },
  {
    q: "А если бот удалит что-то нужное?",
    a:
      "В журнале видно каждое удаление с причиной, и любое сообщение возвращается одной " +
      "кнопкой. Есть белый список слов и ссылок, свои исключения для участников и " +
      "отдельная кнопка «не наказывать», чтобы снять наказание, не восстанавливая сообщение.",
  },
  {
    q: "Спамеры обходят фильтры звёздочками и цифрами. Это поможет?",
    a:
      "Именно на это фильтр и рассчитан. Перед проверкой текст нормализуется: убираются " +
      "разделители внутри слов, цифры и латинские буквы возвращаются к кириллическим " +
      "аналогам, а совпадение ищется с допуском на опечатки — поэтому «п0шёл», «с у к а» " +
      "и «п*дарас» ловятся так же, как обычное написание.",
  },
];

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_TAGLINE,
      applicationCategory: "CommunicationApplication",
      operatingSystem: "Telegram",
      inLanguage: ["ru", "uz"],
      featureList: FEATURES.map((f) => f.title),
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ],
};

export default function LandingPage() {
  return (
    <>
      <TelegramBounce />
      <script
        type="application/ld+json"
        // `<` is escaped so a future string containing "</script>" cannot break
        // out of this block. JSON.stringify alone does not do that.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[880px] px-5 sm:px-6">
          <Header />
          <Hero />
          <Features />
          <HowTo />
          <FaqSection />
        </div>
      </main>

      <Footer />
    </>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between gap-3 py-5">
      <span className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--ink)" }}>
        {SITE_NAME}
      </span>
      {BOT_URL && (
        <a
          href={BOT_URL}
          className="text-[13px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          Открыть бота →
        </a>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="pt-8 pb-12 sm:pt-14 sm:pb-16">
      <p
        className="text-[12px] font-semibold uppercase tracking-[0.08em] mb-4"
        style={{ color: "var(--accent)" }}
      >
        Бот-модератор для Telegram-групп
      </p>

      <h1
        className="text-[28px] sm:text-[40px] font-bold leading-[1.15] tracking-tight max-w-[18ch] sm:max-w-[20ch]"
        style={{ color: "var(--ink)" }}
      >
        Чат чистится сам — от мата, рекламы и вирусных .apk
      </h1>

      <p
        className="mt-4 text-[15px] sm:text-[17px] leading-relaxed max-w-[52ch]"
        style={{ color: "var(--ink-secondary)" }}
      >
        {SITE_TAGLINE} Добавьте бота администратором — дальше он работает без вас,
        а вы видите каждое удаление в журнале и можете отменить любое.
      </p>

      <p className="mt-2.5 text-[13px] leading-relaxed max-w-[52ch]" style={{ color: "var(--ink-muted)" }} lang="uz">
        {TAGLINE_UZ}
      </p>

      <div className="mt-7 flex flex-wrap items-center gap-2.5">
        {ADD_TO_GROUP_URL && (
          <a
            href={ADD_TO_GROUP_URL}
            className="inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-[14px] font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            ➕ Добавить в группу
          </a>
        )}
        {BOT_URL && (
          <a
            href={BOT_URL}
            className="inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-[14px] font-semibold"
            style={{
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--border-strong)",
            }}
          >
            Открыть бота
          </a>
        )}
      </div>

      <p className="mt-4 text-[13px]" style={{ color: "var(--ink-muted)" }}>
        Бесплатно для базовой модерации · Русский и ўзбекча · Реакция — в момент отправки
        сообщения, ещё до того, как его успеют прочитать
      </p>
    </section>
  );
}

function SectionTitle({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="text-[20px] sm:text-[24px] font-bold tracking-tight mb-5"
      style={{ color: "var(--ink)" }}
    >
      {children}
    </h2>
  );
}

function Features() {
  return (
    <section className="py-10 sm:py-12" style={{ borderTop: "1px solid var(--border)" }}>
      <SectionTitle>Что бот делает в чате</SectionTitle>

      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-[16px] p-4"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <span className="text-[20px] leading-none" aria-hidden="true">
              {f.icon}
            </span>
            <h3 className="mt-2.5 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {f.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowTo() {
  return (
    <section className="py-10 sm:py-12" style={{ borderTop: "1px solid var(--border)" }}>
      <SectionTitle>Как подключить за три шага</SectionTitle>

      <ol className="flex flex-col gap-3 sm:flex-row sm:gap-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex-1 rounded-[16px] p-4"
            style={{ background: "var(--surface-sunken)", border: "1px solid var(--border)" }}
          >
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold"
              style={{ background: "var(--accent-wash)", color: "var(--accent-strong)" }}
            >
              {i + 1}
            </span>
            <h3 className="mt-2.5 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {step.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      {ADD_TO_GROUP_URL && (
        <a
          href={ADD_TO_GROUP_URL}
          className="mt-5 inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-[14px] font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          ➕ Добавить в группу
        </a>
      )}
    </section>
  );
}

function FaqSection() {
  return (
    <section className="py-10 sm:py-12" style={{ borderTop: "1px solid var(--border)" }}>
      <SectionTitle>Частые вопросы</SectionTitle>

      <div className="flex flex-col gap-3">
        {FAQ.map((item) => (
          <div
            key={item.q}
            className="rounded-[16px] p-4"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {item.q}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-secondary)" }}>
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
      <div className="mx-auto w-full max-w-[880px] px-5 sm:px-6 py-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              {SITE_NAME}
            </p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {SITE_TAGLINE}
            </p>
          </div>

          <nav className="flex items-center gap-4 text-[13px]">
            <Link href="/privacy" style={{ color: "var(--ink-secondary)" }}>
              Политика конфиденциальности
            </Link>
            {BOT_URL && (
              <a href={BOT_URL} style={{ color: "var(--accent)" }}>
                Открыть бота
              </a>
            )}
          </nav>
        </div>

        {ADD_TO_GROUP_URL && (
          <a
            href={ADD_TO_GROUP_URL}
            className="mt-6 inline-flex items-center justify-center rounded-[12px] px-5 py-3 text-[14px] font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            ➕ Добавить в группу
          </a>
        )}
      </div>
    </footer>
  );
}

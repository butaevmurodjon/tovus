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
 * here beyond the inline bounce script + TelegramBounce — see the ordering
 * note above BOUNCE_SCRIPT and the long note in TelegramBounce.tsx for why
 * server-side sniffing is impossible, not merely discouraged.
 *
 * DESIGN: minimalist by instruction. Ink on off-white, one filled control,
 * hairline rules as the only decoration, and a single fluid type scale that
 * gets genuinely large on desktop (80px headline). All of the type lives in
 * the `--lp-*` / `.lp-*` block at the bottom of app/globals.css; Tailwind is
 * used here only for layout. No cards, no shadows, no gradients, no icons.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FLASH FIX — read this before touching anything above <main>.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Problem: a Mini App opened on the legacy `/` URL used to paint the landing
 * for a frame or two before <TelegramBounce/>'s useEffect could run, because
 * effects only fire AFTER hydration — i.e. after React has rendered the whole
 * page into the DOM and the browser has painted it.
 *
 * Fix: this script is emitted as the FIRST node of the returned markup, so in
 * the streamed HTML it sits immediately after <body>, before a single pixel of
 * landing content exists in the document. A classic inline <script> is a
 * parser-blocking synchronous script: the HTML parser stops, runs it to
 * completion, and only then continues building the rest of the page. If it
 * calls `location.replace()`, the navigation is already in flight before the
 * landing markup has even been parsed — there is nothing to paint.
 *
 * Order of the four things that matter, and why the result is race-safe:
 *
 *  1. `telegram-web-app.js` is loaded in the root layout's <head> with
 *     next/script `strategy="beforeInteractive"`, which emits a plain blocking
 *     <script src> in <head>. So by the time the parser reaches <body>,
 *     `window.Telegram.WebApp.initData` is normally ALREADY populated.
 *  2. This script therefore checks TWO independent signals and ORs them:
 *       a. the URL fragment matching /[#&?]tgWebAppData=/ — true even if
 *          telegram-web-app.js was blocked, failed to load from the CDN, or
 *          simply had not finished, since Telegram puts the fragment on the
 *          URL itself;
 *       b. a non-empty `window.Telegram.WebApp.initData` — true for clients
 *          that hand initData over through the injected bridge and rewrite the
 *          URL before the page runs, so signal (a) is already gone.
 *     Neither signal alone covers both worlds; together they leave no window
 *     in which a Telegram open reaches the landing paint. That is the whole
 *     race-safety argument.
 *  3. <TelegramBounce/> (hydration-time, same predicate) is the third look,
 *     for the residual case where BOTH signals were absent at parse time and
 *     only became true once the Telegram bridge finished initialising.
 *  4. Inside the detected branch only, `documentElement.style.visibility` is
 *     set to "hidden" BEFORE `location.replace()`. `replace()` is not
 *     instantaneous — the browser may still paint while the navigation is in
 *     flight — and this kills that last frame. It is deliberately NOT a
 *     CSS-default-hidden trick: the served HTML is fully visible, so a crawler
 *     with JS disabled, or Googlebot rendering with no Telegram signal, gets
 *     the complete page. Nothing is hidden unless Telegram was detected.
 *
 * Anti-loop / anti-false-positive guards:
 *
 *  - `location.pathname !== "/"` bails out anywhere but the landing. `/app` is
 *    a different route so a loop is structurally impossible already; the check
 *    makes it explicit and costs nothing.
 *  - The hash test is `/[#&?]tgWebAppData=/`, NOT "hash is non-empty". The
 *    landing has in-page anchors (#features, #how, #faq) and a non-empty test
 *    would throw every visitor who clicked one into the Mini App.
 *  - `initData` is checked for `length > 0`. `window.Telegram.WebApp` exists in
 *    an ordinary browser tab too, as soon as telegram-web-app.js has loaded,
 *    with `initData === ""`. Testing for the object alone would redirect every
 *    ordinary visitor and every crawler off the landing page. An empty string
 *    is NOT a Telegram context.
 *  - The whole body is wrapped in try/catch: if anything here throws, the
 *    visitor keeps the landing rather than a blank screen.
 *  - The hash is carried over verbatim (`"/app" + hash`). That fragment IS the
 *    session; strip it and the Mini App renders "открой через кнопку в боте".
 *
 * Keep the predicate here and the one in TelegramBounce.tsx identical.
 */
const BOUNCE_SCRIPT = `(function(){try{
if(location.pathname!=="/")return;
var h=location.hash||"";
var w=window.Telegram&&window.Telegram.WebApp;
var d=w&&w.initData;
if(!/[#&?]tgWebAppData=/.test(h)&&!(typeof d==="string"&&d.length>0))return;
document.documentElement.style.visibility="hidden";
location.replace("/app"+h);
}catch(e){}})();`;

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

/**
 * Uzbek Cyrillic, mirroring the bot's own `welcomePrivate` string in
 * lib/i18n/dictionaries/uz.json — including its `фирибгарлик (скам)` gloss, so
 * the site and the bot say the same thing in the same words.
 */
const TAGLINE_UZ =
  "Чатни сўкиниш, реклама, фирибгарлик (скам) ва вирусли .apk файллардан тозалайди — " +
  "рус ва ўзбек тилларида.";

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

/**
 * No `icon` field any more: the emoji were dropped with the redesign ("no icon
 * soup"). `title` is load-bearing beyond the visible page — it feeds the
 * SoftwareApplication `featureList` in the JSON-LD below.
 */
type Feature = { title: string; body: string };

const FEATURES: Feature[] = [
  {
    title: "Мат и оскорбления — вместе с обходами",
    body:
      "Ловит не только словарь, но и попытки его обойти: звёздочки, цифры вместо букв, " +
      "пробелы внутри слова, латиница вместо кириллицы. Плюс свои слова и готовые " +
      "отраслевые наборы.",
  },
  {
    title: "Реклама, спам и скам",
    body:
      "Антиспам-эвристики против чужих каналов, приглашений, «пишите в ЛС», ссылок " +
      "и флуда — включая рекламу и скам, прилетевшие цитатой из другого чата.",
  },
  {
    title: "Скам-схемы и фишинг",
    body:
      "«Лёгкий заработок на отзывах», фейковые розыгрыши, «ваш аккаунт заблокирован» " +
      "и ссылки на фишинговые сайты распознаются как отдельный класс — со своей " +
      "причиной в журнале, а не под общим ярлыком «спам».",
  },
  {
    title: "Вирусные .apk и .exe",
    body:
      "Фейковые «приложения банка» и «госуслуг» — самый частый скам в местных чатах — " +
      "удаляются вместе с сообщением, в том числе когда установщик процитирован из " +
      "чужого канала, а не прикреплён напрямую.",
  },
  {
    title: "Проверка новичков по CAS",
    body:
      "Каждый вошедший сверяется с публичной базой забаненных спамеров и скамеров " +
      "Combot Anti-Spam. Известный мошенник не успевает написать первое сообщение.",
  },
  {
    title: "ИИ-разбор спорных случаев",
    body:
      "Пограничные сообщения, которые правилам не по зубам, уходят в DeepSeek — " +
      "в группах с включённым премиум-режимом. Остальное решается локально и бесплатно.",
  },
  {
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
      "Фильтр мата, антиспам, анти-скам, удаление опасных файлов, проверка по CAS, капча, " +
      "антирейд и журнал удалений — бесплатно навсегда, для групп любого размера. Платный " +
      "тариф PRO — 199 Telegram Stars в месяц (примерно $3) или 1990 ⭐ за год — добавляет " +
      "ИИ-модерацию спорных случаев, общий бан-лист между вашими группами и полную " +
      "аналитику. Оплата прямо в Telegram.",
  },
  {
    q: "Какие права нужны боту?",
    a:
      "Два: «Удаление сообщений» — нужно для любого действия, и «Блокировка участников» — " +
      "для мута, бана и капчи. Больше ничего бот не просит. Если права выданы не полностью, " +
      "он напишет в чат, чего именно не хватает.",
  },
  {
    q: "Что именно считается скамом?",
    a:
      "Фейковые «приложения банка» и «госуслуг» в виде .apk, ссылки на фишинговые сайты, " +
      "схемы «лёгкого заработка» и «оплаты за отзывы», фейковые розыгрыши и рассылки " +
      "«ваш аккаунт заблокирован», а также аккаунты, уже забаненные за мошенничество в базе " +
      "CAS. Спорные случаи в премиум-группах дополнительно разбирает ИИ.",
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
      {/*
        FIRST NODE ON PURPOSE — see the BOUNCE_SCRIPT comment above. Anything
        inserted before this re-opens the flash bug, because the parser would
        have to build that markup before it reaches the redirect.
      */}
      <script dangerouslySetInnerHTML={{ __html: BOUNCE_SCRIPT }} />

      {/* Hydration-time backstop; renders nothing. */}
      <TelegramBounce />

      <script
        type="application/ld+json"
        // `<` is escaped so a future string containing "</script>" cannot break
        // out of this block. JSON.stringify alone does not do that.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />

      <main className="lp-page flex-1">
        <div className="lp-shell">
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
    <header className="flex items-center justify-between gap-4 py-6 sm:py-8">
      <span
        className="lp-small"
        style={{ color: "var(--ink)", fontWeight: 600, letterSpacing: "-0.01em" }}
      >
        {SITE_NAME}
      </span>
      {BOT_URL && (
        <a href={BOT_URL} className="lp-link lp-small">
          Открыть бота →
        </a>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section
      className="lp-rule"
      style={{ paddingTop: "var(--lp-section)", paddingBottom: "var(--lp-section)" }}
    >
      <p className="lp-eyebrow">Бот-модератор для Telegram-групп</p>

      {/*
        No max-width: at the 80px upper bound of --lp-display the 1120px shell
        already wraps this into three balanced lines (text-wrap: balance), which
        is exactly the intended proportion. Constraining it further would push
        it to five.
      */}
      <h1 className="lp-display" style={{ marginTop: "clamp(1.25rem, 0.7rem + 2.6vw, 2.5rem)" }}>
        Чат чистится сам — от мата, рекламы, скама и вирусных .apk
      </h1>

      <p
        className="lp-lead lp-measure"
        style={{ marginTop: "clamp(1.5rem, 1rem + 2.2vw, 2.75rem)" }}
      >
        {SITE_TAGLINE} Добавьте бота администратором — дальше он работает без вас,
        а вы видите каждое удаление в журнале и можете отменить любое.
      </p>

      <p className="lp-small lp-measure-wide" style={{ marginTop: "1rem" }} lang="uz">
        {TAGLINE_UZ}
      </p>

      <div
        className="flex flex-wrap items-center gap-3"
        style={{ marginTop: "clamp(2rem, 1.4rem + 2.6vw, 3.25rem)" }}
      >
        {ADD_TO_GROUP_URL && (
          <a href={ADD_TO_GROUP_URL} className="lp-cta">
            Добавить в группу
          </a>
        )}
        {BOT_URL && (
          <a href={BOT_URL} className="lp-cta-ghost">
            Открыть бота
          </a>
        )}
      </div>

      <p className="lp-small lp-measure-wide" style={{ marginTop: "1.25rem" }}>
        Бесплатно для базовой модерации · Русский и ўзбекча · Реакция — в момент отправки
        сообщения, ещё до того, как его успеют прочитать
      </p>
    </section>
  );
}

/**
 * A section head is a single 48px line on desktop with a lot of air under it.
 * No intro paragraph under any section on purpose — that is what keeps the
 * page short enough to read in one scroll. The `id` is the in-page anchor
 * target, which is exactly why the bounce script tests for `tgWebAppData=`
 * rather than "hash is non-empty".
 */
function SectionHead({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "clamp(2rem, 1.4rem + 2.4vw, 3.5rem)" }}>
      <h2 id={id} className="lp-title lp-measure-tight">
        {children}
      </h2>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="lp-rule"
      style={{ paddingTop: "var(--lp-section)", paddingBottom: "var(--lp-section)" }}
    >
      {children}
    </section>
  );
}

function Features() {
  return (
    <Section>
      <SectionHead id="features">Что бот делает в чате</SectionHead>

      <ul className="grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:gap-x-20" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {FEATURES.map((f) => (
          <li key={f.title} className="lp-rule" style={{ paddingTop: "1.25rem" }}>
            <h3 className="lp-subhead">{f.title}</h3>
            <p className="lp-body" style={{ marginTop: "0.6rem" }}>
              {f.body}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HowTo() {
  return (
    <Section>
      <SectionHead id="how">Как подключить за три шага</SectionHead>

      <ol
        className="grid gap-x-12 gap-y-9 sm:grid-cols-3 lg:gap-x-20"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {STEPS.map((step, i) => (
          <li key={step.title} className="lp-rule" style={{ paddingTop: "1.25rem" }}>
            <span className="lp-numeral" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="lp-subhead" style={{ marginTop: "0.75rem" }}>
              {step.title}
            </h3>
            <p className="lp-body" style={{ marginTop: "0.6rem" }}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      {ADD_TO_GROUP_URL && (
        <a
          href={ADD_TO_GROUP_URL}
          className="lp-cta"
          style={{ marginTop: "clamp(2rem, 1.4rem + 2.4vw, 3rem)" }}
        >
          Добавить в группу
        </a>
      )}
    </Section>
  );
}

function FaqSection() {
  return (
    <Section>
      <SectionHead id="faq">Частые вопросы</SectionHead>

      <div className="flex flex-col" style={{ gap: "clamp(1.75rem, 1.2rem + 1.6vw, 2.5rem)" }}>
        {FAQ.map((item) => (
          <div key={item.q} className="lp-rule" style={{ paddingTop: "1.25rem" }}>
            <h3 className="lp-subhead lp-measure-tight">{item.q}</h3>
            <p className="lp-body lp-measure-wide" style={{ marginTop: "0.6rem" }}>
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Footer() {
  return (
    <footer className="lp-page lp-rule">
      <div className="lp-shell" style={{ paddingTop: "3rem", paddingBottom: "3rem" }}>
        <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-8">
          <div className="lp-measure">
            <p className="lp-small" style={{ color: "var(--ink)", fontWeight: 600 }}>
              {SITE_NAME}
            </p>
            <p className="lp-small" style={{ marginTop: "0.5rem" }}>
              {SITE_TAGLINE}
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Link href="/privacy" className="lp-small" style={{ color: "var(--ink-secondary)" }}>
              Политика конфиденциальности
            </Link>
            {BOT_URL && (
              <a href={BOT_URL} className="lp-link lp-small">
                Открыть бота
              </a>
            )}
          </nav>
        </div>

        {ADD_TO_GROUP_URL && (
          <a href={ADD_TO_GROUP_URL} className="lp-cta" style={{ marginTop: "2.5rem" }}>
            Добавить в группу
          </a>
        )}
      </div>
    </footer>
  );
}

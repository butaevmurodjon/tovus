import { describe, expect, it } from "vitest";
import type { Message, MessageEntity } from "grammy/types";
import { detectSpam } from "./spam";

function msg(text: string, entities?: MessageEntity[], forward_origin?: Message["forward_origin"]): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "supergroup", title: "t" },
    text,
    entities,
    forward_origin,
  } as unknown as Message;
}

function quoteMsg(
  ownText: string,
  quoteText: string,
  options: { external?: boolean; quoteEntities?: MessageEntity[] } = {}
): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "supergroup", title: "t" },
    text: ownText,
    quote: { text: quoteText, entities: options.quoteEntities, position: 0 },
    external_reply:
      options.external ?? true
        ? { origin: { type: "channel", date: 0, chat: { id: -100, type: "channel", title: "ad channel" }, message_id: 639874 } }
        : undefined,
  } as unknown as Message;
}

function docMsg(document: Partial<NonNullable<Message["document"]>>, caption?: string): Message {
  return {
    message_id: 1,
    date: 0,
    chat: { id: 1, type: "supergroup", title: "t" },
    document: { file_id: "f1", file_unique_id: "u1", ...document },
    caption,
  } as unknown as Message;
}

describe("detectSpam", () => {
  it("does not double-count a single link parsed as a Telegram URL entity (regression)", () => {
    // Before the fix, the entity-derived link AND the regex fallback scan both ran
    // unconditionally, so one ordinary link counted as two and tripped the
    // "2+ links" rule on a perfectly normal message.
    const result = detectSpam(
      msg("Смотрите тут: https://example.com/page", [{ type: "url", offset: 14, length: 26 }])
    );
    expect(result.matched).toBe(false);
  });

  it("flags two distinct links as low-severity spam", () => {
    const result = detectSpam(
      msg("https://a.com and https://b.com", [
        { type: "url", offset: 0, length: 14 },
        { type: "url", offset: 19, length: 14 },
      ])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("low");
  });

  it("flags blacklisted shortener domains as high severity", () => {
    const result = detectSpam(msg("жми bit.ly/xyz123", [{ type: "url", offset: 4, length: 14 }]));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("flags t.me invite links as high severity", () => {
    const result = detectSpam(msg("заходи t.me/+abc123", [{ type: "url", offset: 7, length: 13 }]));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("flags a call-to-action phrase paired with a link", () => {
    const result = detectSpam(
      msg("пиши в лс для заработка https://foo.com", [{ type: "url", offset: 25, length: 15 }])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("leaves ordinary conversation alone", () => {
    expect(detectSpam(msg("привет как дела, увидимся вечером")).matched).toBe(false);
  });

  it("falls back to a plain-text URL scan only when there are no entities", () => {
    expect(detectSpam(msg("зайди на https://example.com/promo")).matched).toBe(false);
  });

  it("flags a masked link — visible text claims one domain, href points elsewhere", () => {
    const text = "заходи на google.com";
    const result = detectSpam(
      msg(text, [{ type: "text_link", offset: 9, length: 10, url: "https://scam-site.example" }])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("scam-site.example");
  });

  it("does not flag a text_link whose visible label is plain text, not a URL", () => {
    const text = "подробнее";
    const result = detectSpam(msg(text, [{ type: "text_link", offset: 0, length: 9, url: "https://example.com" }]));
    expect(result.matched).toBe(false);
  });

  it("does not flag a text_link whose visible text matches its real host", () => {
    const text = "see example.com for details";
    const result = detectSpam(
      msg(text, [{ type: "text_link", offset: 4, length: 11, url: "https://example.com/details" }])
    );
    expect(result.matched).toBe(false);
  });

  it("flags a brand-name word cloaking a t.me bot startapp link (2026-08-25 audit, real-world example)", () => {
    // findMaskedLinkHost only fires when the visible anchor text itself looks
    // like a URL — this evades that on purpose by hyperlinking an ordinary
    // trusted word ("amnezia", a real VPN app) straight to a bot's startapp
    // deep link. Real sample: a VPN-recommendation testimonial where "amnezia"
    // was secretly a link to https://t.me/for_testing_everything_yeah_bot?startapp=<uuid>.
    const text = "я на amnezia сижу, у них свой протокол который блокировки обходит, стабильно работает!";
    const result = detectSpam(
      msg(text, [
        {
          type: "text_link",
          offset: 5,
          length: 7,
          url: "https://t.me/for_testing_everything_yeah_bot?startapp=bfc57216-28f8-4d47-a10e-1cf57acbe744",
        },
      ])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("for_testing_everything_yeah_bot");
  });

  it("does not flag an ordinary VPN recommendation with no link at all", () => {
    // The prose here ("many VPNs are down, I use X, works great") is common,
    // legitimate chat during block waves and must not be flagged by itself —
    // only the cloaked-link delivery mechanism is the actual spam signal.
    const text = "многие VPN сейчас легли, я на amnezia сижу, стабильно работает";
    expect(detectSpam(msg(text)).matched).toBe(false);
  });

  it("does not flag a text_link to a t.me bot whose visible text names the bot/link openly", () => {
    const text = "запусти бота t.me/some_bot?startapp=xyz";
    const result = detectSpam(
      msg(text, [{ type: "text_link", offset: 13, length: 27, url: "https://t.me/some_bot?startapp=xyz" }])
    );
    expect(result.matched).toBe(false);
  });

  it("flags an ad relayed via Telegram's Quote-reply feature from another channel (real-world example, 2026-08-26)", () => {
    // The sender's own text is an innocuous-sounding recommendation; the full
    // ad pitch (VanyaVPN) rides along in message.quote/external_reply, which
    // no other check in this file ever looks at.
    const adText = [
      "🔥 Бесплатный впн VanyaVPN",
      "Надоели блокировки, медленная загрузка и ограничения?",
      "⚡️ Быстрое подключение",
      "🔒 Защита вашего соединения",
      "🌍 115 бесплатных локаций",
      "📱 Работает на телефоне и компьютере",
      "Скачивай наше приложение и пользуйся интернетом на своих условиях.",
    ].join("\n");
    const result = detectSpam(quoteMsg("Хороший впн, советую", adText));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("из другого чата/канала");
  });

  it("still flags the same ad when the quote is truncated to just its opening line", () => {
    // Telegram's client UI (and a manually-selected quote.is_manual excerpt)
    // can cut a quote down to a couple dozen characters — detection must not
    // depend on the ad's closing CTA line surviving that truncation.
    const truncated = "🔥 Бесплатный впн VanyaVPN\nН";
    const result = detectSpam(quoteMsg("Хороший впн, советую", truncated));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("flags a quote-relayed ad even without external_reply (ad already quoted from the same chat)", () => {
    const result = detectSpam(quoteMsg("го глянь", "скачивай наше приложение и получи бонус", { external: false }));
    expect(result.matched).toBe(true);
    expect(result.reason).not.toContain("из другого чата/канала");
  });

  it("flags a bare CTA phrase in a quote as low severity — no ad-hook marker to distinguish relay from warning-about-spam", () => {
    // Quoting a message to warn about it ("не ведитесь, это скам: ...") looks
    // identical at this level, so an unmarked CTA-in-quote can't be high the
    // way a QUOTE_AD_MARKERS hit is.
    const result = detectSpam(quoteMsg("осторожно, вот такое рассылают", "хочешь заработать без вложений?"));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("low");
  });

  it("does not flag an ordinary quote-reply with no ad content", () => {
    const result = detectSpam(quoteMsg("+1, согласен", "давайте перенесём встречу на завтра"));
    expect(result.matched).toBe(false);
  });

  it("flags a blacklisted domain hidden in a quoted ad (plain-text URL, no entities)", () => {
    // TextQuote.entities never carries a "url" entity (Bot API strips it, same
    // as text_link) — this must go through extractLinks' regex fallback, which
    // only matches URLs with an explicit https://, t.me/, or www. prefix.
    const result = detectSpam(quoteMsg("зацени", "полная версия тут: https://bit.ly/free-vpn-full"));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("bit.ly");
  });

  it("flags a malware installer relayed via Quote-reply — the .apk lives in external_reply.document, not message.document (real example, 2026-08-27: Erwines VPN.apk)", () => {
    // The sender's own text is innocuous ("Спасибо!! Грузит!!)"); the actual
    // payload — an .apk from another channel — rides along in
    // external_reply.document, a field findDangerousFileTag didn't read before.
    const message = {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: "supergroup", title: "t" },
      text: "Спасибио!! Грузьит!!)",
      quote: { text: "Erwines VPN", position: 0 },
      external_reply: {
        origin: { type: "channel", date: 0, chat: { id: -100, type: "channel", title: "ad channel" }, message_id: 12 },
        document: { file_id: "f1", file_unique_id: "u1", file_name: "Erwines VPN.apk" },
      },
    } as unknown as Message;
    const result = detectSpam(message);
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("цитируемом сообщении");
    expect(result.reason).toContain(".apk");
  });

  it("flags a quote-relayed installer by MIME when the extension was renamed off the file", () => {
    const message = {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: "supergroup", title: "t" },
      text: "спасибо, работает",
      external_reply: {
        origin: { type: "channel", date: 0, chat: { id: -100, type: "channel", title: "c" }, message_id: 9 },
        document: { file_id: "f", file_unique_id: "u", file_name: "vpn", mime_type: "application/vnd.android.package-archive" },
      },
    } as unknown as Message;
    const result = detectSpam(message);
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("does not flag a harmless file (pdf) quoted from another chat", () => {
    const message = {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: "supergroup", title: "t" },
      text: "вот документ",
      external_reply: {
        origin: { type: "channel", date: 0, chat: { id: -100, type: "channel", title: "c" }, message_id: 9 },
        document: { file_id: "f", file_unique_id: "u", file_name: "договор.pdf", mime_type: "application/pdf" },
      },
    } as unknown as Message;
    expect(detectSpam(message).matched).toBe(false);
  });

  it("flags a CTA forwarded from a regular user, not just from a channel", () => {
    const result = detectSpam(
      msg("пиши в лс, есть предложение", undefined, { type: "user", date: 0, sender_user: { id: 1, is_bot: false, first_name: "A" } } as unknown as Message["forward_origin"])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("flags a single @mention paired with a CTA phrase as low severity", () => {
    const result = detectSpam(
      msg("@friend хочешь заработать?", [{ type: "mention", offset: 0, length: 7 }])
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("low");
  });

  it("does not flag an @mention without any CTA phrase", () => {
    const result = detectSpam(msg("@friend как дела?", [{ type: "mention", offset: 0, length: 7 }]));
    expect(result.matched).toBe(false);
  });

  it("flags an uz-latin DM-bait ad paired with a mention (2026-08-25 audit, real-world example)", () => {
    // CTA_PHRASES previously only covered ru + uz-cyrl (per its own comment) —
    // this real solicitation ad (paid coursework/presentation writing,
    // redirecting to DM or a "group in bio") is standard uz-latin and slipped
    // through undetected until the uz-latin + "bio redirect" phrases were added.
    const text =
      "Qolyozma daftar list Elektron prezentatsiyalar maqola Slayd Amaliy ish bolsa tayyorlab beraman " +
      "tayyorlatmoqchilar lich yozilar yoki biodagi gruppamga yozinglar";
    const result = detectSpam(msg(`@Bahor_0422 ${text}`, [{ type: "mention", offset: 0, length: 12 }]));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("low");
  });

  it("does not flag ordinary uz-latin conversation containing the new phrases' word stems", () => {
    // Stress-test for the "biodagi guruh"/"biodagi grupp" stems added alongside
    // the uz-latin CTA phrases — must not fire on benign uses of "guruh"/"bio"/"menga".
    expect(detectSpam(msg("Guruhga yangi a'zo qo'shildi, xush kelibsiz")).matched).toBe(false);
    expect(detectSpam(msg("Menga bugun kitob kerak edi, kim biladimi qayerdan olsa bo'ladi")).matched).toBe(false);
    expect(detectSpam(msg("Bio-fizika darsi ertaga soat 9 da boshlanadi")).matched).toBe(false);
    expect(detectSpam(msg("Prezentatsiya tayyor, ertaga yuklayman")).matched).toBe(false);
  });

  it("flags a pay-for-views job scam with no links or mentions (RabotaUzb-style) at high severity", () => {
    const text = [
      "✅ Ищем работников на онлайн биржу приложение RabotaUzb",
      "В чем заключается работа:",
      "- Просмотр рекламных роликов рекламодателей",
      "- Написание отзывов на Google и Яндекс картах",
      "- Просмотр роликов на YouTube\\TikTok наших рекламодателей",
      "❤️ Фиксированая ставка 75.000 Сум за час, с бонусами до 100.000",
      "🤖 Для связи пишите менеджеру (только на русском языке): @maryammanag",
    ].join("\n");
    const result = detectSpam(msg(text));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain("скам-схема");
  });

  it("does not flag a legitimate plain job offer with no scam-scheme phrases", () => {
    const result = detectSpam(
      msg("Ищем работников на склад. Опыт не нужен, фиксированная ставка за час, график 5/2.")
    );
    expect(result.matched).toBe(false);
  });

  it("flags an .apk file even with no caption at all (regression — scam APKs are usually sent bare)", () => {
    const result = detectSpam(docMsg({ file_name: "Mobile_Bank_Update.apk" }));
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
    expect(result.reason).toContain(".apk");
  });

  it("flags Windows/script executables by extension (.exe, .bat, .jar, .ps1)", () => {
    for (const name of ["setup.exe", "install.bat", "loader.jar", "run.ps1"]) {
      expect(detectSpam(docMsg({ file_name: name })).matched).toBe(true);
    }
  });

  it("falls back to mime_type when the extension is stripped or renamed", () => {
    const result = detectSpam(
      docMsg({ file_name: "photo.jpg", mime_type: "application/vnd.android.package-archive" })
    );
    expect(result.matched).toBe(true);
    expect(result.severity).toBe("high");
  });

  it("is case-insensitive on the extension", () => {
    expect(detectSpam(docMsg({ file_name: "App.APK" })).matched).toBe(true);
  });

  it("does not flag ordinary document types", () => {
    for (const name of ["contract.pdf", "photo.jpg", "report.docx", "data.xlsx"]) {
      expect(detectSpam(docMsg({ file_name: name })).matched).toBe(false);
    }
  });

  it("does not flag a document with no file_name and a safe mime_type", () => {
    expect(detectSpam(docMsg({ mime_type: "application/pdf" })).matched).toBe(false);
  });
});

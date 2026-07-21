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

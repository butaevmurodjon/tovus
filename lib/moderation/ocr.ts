import type { Api } from "grammy";
import type { PhotoSize } from "grammy/types";
import { fetchWithTimeout } from "@/lib/http";
import { incrWithTtl } from "@/lib/db/redis";

/**
 * ROADMAP.md §7.3 "OCR текста с картинок" (@LolsBot): a spam post with the
 * ad pitch baked into the image itself ("Заработок 500$/день, пиши в лс
 * @xxx") and little/no caption sails straight through every text-based
 * check we have — detectSpam/detectProfanity never see a single character
 * of it. This reads the image's text via an external OCR API and hands it
 * back to the caller (index.ts) to run through the SAME checks as ordinary
 * message text.
 *
 * Owner's explicit call (2026-09-14): ships against an external OCR
 * provider (OCR.space) despite the open 152-ФЗ/ЗРУ-547 question already
 * flagged in MONETIZATION.md §7 for photo processing generally — a member's
 * photo leaves our infra either way, whether the goal is "read the text on
 * it" (this) or "look at faces/bodies in it" (the still-deferred avatar
 * check). Different provider question, same underlying legal exposure —
 * this does NOT resolve that MONETIZATION.md item, it's a second feature
 * accepting the same class of risk on the owner's decision.
 *
 * Fully opt-in and gated twice: per-group (`ocrEnabled`, default false) AND
 * bot-wide on `OCR_API_KEY` being set at all (absent in dev/most
 * environments — same pattern as DEEPSEEK_API_KEY). Either gate missing
 * means this is a silent no-op, never a thrown error on the moderation path.
 */
const OCR_TIMEOUT_MS = 8000;
const MAX_OCR_TEXT_LENGTH = 2000;
// OCR.space's free tier caps out around 25k requests/month; this stays far
// under that bot-wide regardless of how many groups turn ocrEnabled on, so
// one runaway group can't silently exhaust everyone else's quota for the
// rest of the day. Deliberately conservative — raise once real usage data
// says it's safe to.
const OCR_DAILY_BUDGET = 500;
// api.ocr.space free-tier accepts images up to ~1MB.
const MAX_IMAGE_BYTES = 1_000_000;

async function withinDailyBudget(): Promise<boolean> {
  const count = await incrWithTtl("ocr:budget:daily", 60 * 60 * 24);
  return count <= OCR_DAILY_BUDGET;
}

/** Largest available size — Bot API always returns `photo` sorted smallest to largest. */
function largestPhoto(photos: PhotoSize[]): PhotoSize {
  return photos[photos.length - 1];
}

/**
 * Downloads the photo via the Bot API (never hands the OCR provider a
 * Telegram file URL with our bot token embedded in it) and extracts any
 * text found. Returns null on any failure, missing config, exhausted
 * budget, or no text found — every case the caller treats identically
 * (nothing to add to the moderation checks).
 */
export async function extractTextFromPhoto(api: Api, photos: PhotoSize[]): Promise<string | null> {
  const apiKey = process.env.OCR_API_KEY;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!apiKey || !token || photos.length === 0) return null;
  if (!(await withinDailyBudget().catch(() => false))) return null;

  const file = await api.getFile(largestPhoto(photos).file_id).catch(() => null);
  if (!file?.file_path) return null;

  const imgRes = await fetchWithTimeout(
    `https://api.telegram.org/file/bot${token}/${file.file_path}`,
    {},
    OCR_TIMEOUT_MS
  ).catch(() => null);
  if (!imgRes?.ok) return null;

  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;

  const body = new URLSearchParams({
    apikey: apiKey,
    base64Image: `data:image/jpeg;base64,${buf.toString("base64")}`,
    // OCR.space language codes: "rus" covers ru-Cyrillic text reasonably;
    // there's no dedicated Uzbek-Cyrillic code, so this is a known accuracy
    // gap for uz-cyrl spam images specifically until/unless OCR.space adds
    // one — better than nothing, not a claim of parity with the ru case.
    language: "rus",
    OCREngine: "2",
    scale: "true",
  });
  const res = await fetchWithTimeout("https://api.ocr.space/parse/image", { method: "POST", body }, OCR_TIMEOUT_MS).catch(
    () => null
  );
  if (!res?.ok) return null;

  const json = (await res.json().catch(() => null)) as { ParsedResults?: { ParsedText?: string }[] } | null;
  const text = json?.ParsedResults?.[0]?.ParsedText;
  if (typeof text !== "string" || !text.trim()) return null;
  return text.trim().slice(0, MAX_OCR_TEXT_LENGTH);
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Api } from "grammy";
import { extractTextFromPhoto } from "./ocr";

describe("extractTextFromPhoto", () => {
  const originalOcrKey = process.env.OCR_API_KEY;
  const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    delete process.env.OCR_API_KEY;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalOcrKey === undefined) delete process.env.OCR_API_KEY;
    else process.env.OCR_API_KEY = originalOcrKey;
    if (originalBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
  });

  it("no-ops without OCR_API_KEY, never touching the api client", async () => {
    const api = { getFile: vi.fn() } as unknown as Api;
    const result = await extractTextFromPhoto(api, [{ file_id: "f1", file_unique_id: "u1", width: 10, height: 10 }]);
    expect(result).toBeNull();
    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("no-ops without TELEGRAM_BOT_TOKEN even if OCR_API_KEY is set", async () => {
    process.env.OCR_API_KEY = "test-key";
    const api = { getFile: vi.fn() } as unknown as Api;
    const result = await extractTextFromPhoto(api, [{ file_id: "f1", file_unique_id: "u1", width: 10, height: 10 }]);
    expect(result).toBeNull();
    expect(api.getFile).not.toHaveBeenCalled();
  });

  it("no-ops on an empty photo list", async () => {
    process.env.OCR_API_KEY = "test-key";
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const api = { getFile: vi.fn() } as unknown as Api;
    const result = await extractTextFromPhoto(api, []);
    expect(result).toBeNull();
    expect(api.getFile).not.toHaveBeenCalled();
  });
});

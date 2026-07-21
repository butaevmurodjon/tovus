import { createHmac } from "node:crypto";

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  raw: string;
}

const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24; // 24h

/**
 * Verifies Telegram Mini App initData per the official HMAC-SHA256 scheme:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string, botToken: string): VerifiedInitData | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : 0;
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TelegramWebAppUser;
    if (!user?.id) return null;
    return { user, authDate, raw: initData };
  } catch {
    return null;
  }
}

export function extractInitData(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("tma ")) return auth.slice(4);
  const header = req.headers.get("x-telegram-init-data");
  if (header) return header;
  return null;
}

import { Api } from "grammy";

let _api: Api | null = null;

/** Standalone Bot API client for use outside the webhook handler (Mini App API routes). */
export function getApi(): Api {
  if (!_api) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    _api = new Api(token);
  }
  return _api;
}

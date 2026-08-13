import { extractInitData, verifyInitData, type TelegramWebAppUser } from "./authInitData";
import { getApi } from "./api";
import { isChatAdmin } from "./adminCheck";
import { isRegisteredGroup } from "@/lib/db/groups";
import { isOwner } from "@/lib/owner";

export function authenticateRequest(req: Request): TelegramWebAppUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN not set");
    return null;
  }
  const raw = extractInitData(req);
  if (!raw) {
    console.error("No initData found");
    return null;
  }
  const verified = verifyInitData(raw, token);
  if (!verified) {
    console.error("initData verification failed");
    return null;
  }
  return verified.user;
}

export type GroupAuthResult =
  | { ok: true; user: TelegramWebAppUser }
  | { ok: false; status: 401 | 403 };

/**
 * Verifies initData and authorizes a group manager.
 *
 * A normal user must still be a current Telegram administrator. The configured
 * bot owner may manage every chat where this bot is currently installed, even
 * if that person is not a chat administrator. Telegram evaluates moderation
 * actions against the bot's rights, not the Mini App user's chat role.
 */
export async function authorizeGroupAdmin(req: Request, chatId: number): Promise<GroupAuthResult> {
  const user = authenticateRequest(req);
  if (!user) return { ok: false, status: 401 };
  if (isOwner(user.id)) {
    return (await isRegisteredGroup(chatId)) ? { ok: true, user } : { ok: false, status: 403 };
  }
  const admin = await isChatAdmin(getApi(), chatId, user.id);
  if (!admin) return { ok: false, status: 403 };
  return { ok: true, user };
}

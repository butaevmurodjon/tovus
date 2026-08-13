import { extractInitData, verifyInitData, type TelegramWebAppUser } from "./authInitData";
import { getApi } from "./api";
import { isChatAdmin } from "./adminCheck";

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

/** Verifies initData AND live-checks that this user is currently an admin of the given chat. */
export async function authorizeGroupAdmin(req: Request, chatId: number): Promise<GroupAuthResult> {
  const user = authenticateRequest(req);
  if (!user) return { ok: false, status: 401 };
  const admin = await isChatAdmin(getApi(), chatId, user.id);
  if (!admin) return { ok: false, status: 403 };
  return { ok: true, user };
}

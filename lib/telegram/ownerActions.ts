import type { Api } from "grammy";
import { GrammyError } from "grammy";
import { isRegisteredGroup } from "@/lib/db/groups";
import { getBotPermissions } from "./adminCheck";

export type OwnerActionCheck =
  | { ok: true }
  | { ok: false; error: "group_unavailable" | "bot_not_admin" | "missing_delete_permission" | "missing_restrict_permission" };

/**
 * Confirms that a manual owner action is scoped to a chat where the bot is
 * currently installed and that Telegram granted the bot the required right.
 * The owner's app-level access never bypasses Telegram's bot permissions.
 */
export async function authorizeOwnerAction(
  api: Api,
  chatId: number,
  action: "delete" | "ban"
): Promise<OwnerActionCheck> {
  if (!(await isRegisteredGroup(chatId))) return { ok: false, error: "group_unavailable" };

  const permissions = await getBotPermissions(api, chatId);
  if (!permissions.isAdmin) return { ok: false, error: "bot_not_admin" };
  if (action === "delete" && !permissions.canDeleteMessages) {
    return { ok: false, error: "missing_delete_permission" };
  }
  if (action === "ban" && !permissions.canRestrictMembers) {
    return { ok: false, error: "missing_restrict_permission" };
  }
  return { ok: true };
}

/** Telegram errors are expected user-facing failures (old message, protected
 * admin, insufficient chat rights), while unknown errors remain server errors. */
export function ownerActionErrorStatus(error: unknown): 400 | 500 {
  return error instanceof GrammyError ? 400 : 500;
}

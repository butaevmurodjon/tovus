import { ApiError } from "./api";

/** Shared Russian copy for the owner-action API error codes (ban/delete
 * routes) — used by both the per-group God Mode panel and the cross-group
 * link/username tool, so the two surfaces can't silently drift in wording
 * for the same underlying error code. */
export function ownerActionErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return "Не удалось выполнить действие. Попробуйте ещё раз.";
  switch (error.message) {
    case "bot_not_admin":
    case "group_unavailable":
      return "Бот больше не подключён к этой группе или не является администратором.";
    case "missing_delete_permission":
      return "У бота нет права удалять сообщения в этой группе.";
    case "missing_restrict_permission":
      return "У бота нет права блокировать участников в этой группе.";
    case "delete_failed":
      return "Сообщение не удалось удалить. Проверьте его ID и права бота.";
    case "ban_failed":
      return "Пользователя не удалось заблокировать. Возможно, это администратор.";
    default:
      return "Не удалось выполнить действие. Попробуйте ещё раз.";
  }
}

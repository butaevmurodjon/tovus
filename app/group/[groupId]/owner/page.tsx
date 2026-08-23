"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";

type Action = "delete" | "ban" | "resetrep";

function errorText(error: unknown): string {
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

export default function GroupOwnerPage() {
  const { fetcher, isOwner } = useApp();
  const { chatId, settings } = useGroup();
  const [messageId, setMessageId] = useState("");
  const [userId, setUserId] = useState("");
  const [repUserId, setRepUserId] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice((current) => (current === text ? null : current)), 2600);
  }

  async function run(action: Action) {
    const raw = action === "delete" ? messageId : action === "ban" ? userId : repUserId;
    const value = Number(raw.trim());
    if (!Number.isInteger(value) || value <= 0) {
      flash(action === "delete" ? "Введите корректный ID сообщения." : "Введите корректный ID пользователя.");
      return;
    }
    const question =
      action === "delete"
        ? `Удалить сообщение №${value} в группе «${settings?.title ?? chatId}»?`
        : action === "ban"
          ? `Заблокировать пользователя ${value} в группе «${settings?.title ?? chatId}»?`
          : `Сбросить репутацию пользователя ${value} в группе «${settings?.title ?? chatId}»?`;
    if (!(await confirmAction(question))) return;

    haptic(action === "ban" ? "medium" : "light");
    setBusy(action);
    try {
      const endpoint = action === "resetrep" ? "resetrep" : action;
      await fetcher(`/api/miniapp/owner/groups/${chatId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(action === "delete" ? { messageId: value } : { userId: value }),
      });
      if (action === "delete") setMessageId("");
      else if (action === "ban") setUserId("");
      else setRepUserId("");
      hapticNotify("success");
      flash(action === "delete" ? "Сообщение удалено." : action === "ban" ? "Пользователь заблокирован." : "Репутация сброшена.");
    } catch (error) {
      hapticNotify("error");
      flash(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  // The navigation item is already hidden for everyone else. Keeping this guard
  // here also prevents a briefly rendered control if a route is opened directly.
  if (!isOwner) return null;

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      {notice && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium" style={{ background: "var(--ink)", color: "#fff" }}>
          {notice}
        </div>
      )}

      <Card>
        <CardSection title="Управление ботом">
          <p className="text-[13px] leading-5" style={{ color: "var(--ink-muted)" }}>
            Действия выполняются ботом в этой группе. Вам не нужны права администратора группы, но у бота должны быть соответствующие права.
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Удалить сообщение">
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            Введите ID сообщения из ссылки или журнала группы.
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={messageId}
              onChange={(event) => setMessageId(event.target.value)}
              placeholder="ID сообщения"
              aria-label="ID сообщения"
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
            <Button variant="secondary" onClick={() => run("delete")} disabled={busy !== null}>
              {busy === "delete" ? "Удаляем…" : "Удалить"}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Ручной бан">
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            Введите числовой Telegram ID пользователя. Бан действует только в этой группе.
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="ID пользователя"
              aria-label="ID пользователя"
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
            <Button variant="danger" onClick={() => run("ban")} disabled={busy !== null}>
              {busy === "ban" ? "Блокируем…" : "Забанить"}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Сбросить репутацию">
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            Обнуляет счётчик репутации пользователя в этой группе — например, если он накопился из-за ложных срабатываний фильтра.
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              type="text"
              value={repUserId}
              onChange={(event) => setRepUserId(event.target.value)}
              placeholder="ID пользователя"
              aria-label="ID пользователя"
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]"
              style={{ borderColor: "var(--border-strong)", background: "var(--surface-sunken)" }}
            />
            <Button variant="secondary" onClick={() => run("resetrep")} disabled={busy !== null}>
              {busy === "resetrep" ? "Сбрасываем…" : "Сбросить"}
            </Button>
          </div>
        </CardSection>
      </Card>
    </div>
  );
}

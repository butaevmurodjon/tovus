"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";
import { ownerActionErrorText } from "@/lib/miniapp/ownerActionErrorText";
import type { AiRule, AiRuleLabel } from "@/lib/db/aiRules";
import type { GlobalBanEntry } from "@/lib/db/types";

type ResolveResult =
  | { type: "message"; chatId: number; messageId: number; authorUserId: number | null; text: string | null }
  | { type: "user"; userId: number; username: string | null };

function resolveErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return "Не удалось разобрать ссылку/юзернейм.";
  switch (error.message) {
    case "chat_not_found":
      return "Группа/канал по этой ссылке не найдены или бот туда не добавлен.";
    case "user_not_found":
      return "Пользователь с таким юзернеймом не найден.";
    case "resolve_failed":
      return "Telegram временно недоступен. Попробуйте ещё раз через момент.";
    default:
      return "Не удалось разобрать ввод. Проверьте ссылку или юзернейм.";
  }
}

function formatDate(ts: number, lang: string): string {
  return new Date(ts).toLocaleString(lang === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Действие" — единый owner-флоу (FAANG-audit PR-4), слияние бывших
 * owner/tools (резолвер ссылки/юзернейма + обучение ИИ) и owner/bans
 * (список глобальных банов). Раньше это были два разных экрана без общей
 * логики — не было очевидно, что оба существуют и чем отличаются. Порядок
 * секций отражает частоту использования: резолвер (самое частое) → баны
 * (список + быстрый бан по ID, когда ссылки нет) → обучение ИИ → личные
 * напоминалки (реже всего).
 *
 * i18n-политика для этого файла: owner-only экраны намеренно НЕ переведены
 * (владелец бота один и русскоязычный) — в отличие от админских экранов
 * (group/[id]/*), которые обязаны идти через t(). Не путать одно с другим.
 */
export default function OwnerActionsPage() {
  const { lang, fetcher } = useApp();
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 2600);
  }

  // --- Section: resolver ---------------------------------------------------
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [acting, setActing] = useState<
    "delete" | "ban-group" | "ban-everywhere" | "ban-and-delete" | "unban-group" | null
  >(null);

  async function resolve() {
    if (!input.trim()) return;
    haptic("light");
    setResolving(true);
    setResolved(null);
    try {
      const result = await fetcher<ResolveResult>("/api/miniapp/owner/resolve", {
        method: "POST",
        body: JSON.stringify({ input: input.trim() }),
      });
      setResolved(result);
    } catch (error) {
      hapticNotify("error");
      flash(resolveErrorText(error));
    } finally {
      setResolving(false);
    }
  }

  async function deleteResolvedMessage() {
    if (!resolved || resolved.type !== "message") return;
    if (!(await confirmAction(`Удалить сообщение №${resolved.messageId}?`))) return;
    haptic("medium");
    setActing("delete");
    try {
      await fetcher(`/api/miniapp/owner/groups/${resolved.chatId}/delete`, {
        method: "POST",
        body: JSON.stringify({ messageId: resolved.messageId }),
      });
      hapticNotify("success");
      flash("Сообщение удалено.");
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setActing(null);
    }
  }

  // Message-link case bans/deletes scoped to the group the link points at —
  // "delete this message" must not silently escalate into a bot-wide ban.
  // Global ban (everywhere) is a separate, explicitly-labeled action below.
  async function banResolvedAuthorInGroup(alsoDelete: boolean) {
    if (!resolved || resolved.type !== "message" || !resolved.authorUserId) return;
    const userId = resolved.authorUserId;
    const question = alsoDelete
      ? `Заблокировать пользователя ${userId} в этой группе и удалить сообщение?`
      : `Заблокировать пользователя ${userId} в этой группе?`;
    if (!(await confirmAction(question))) return;
    haptic("medium");
    setActing(alsoDelete ? "ban-and-delete" : "ban-group");
    try {
      await fetcher(`/api/miniapp/owner/groups/${resolved.chatId}/ban`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      let deleteFailed = false;
      if (alsoDelete) {
        // The ban route above already best-effort deletes the author's last
        // cached message server-side, which is often (but not always — the
        // owner may have linked an older message) this same message. Track
        // the outcome instead of swallowing it, so the toast doesn't claim a
        // delete succeeded when it may genuinely have failed (permissions).
        await fetcher(`/api/miniapp/owner/groups/${resolved.chatId}/delete`, {
          method: "POST",
          body: JSON.stringify({ messageId: resolved.messageId }),
        }).catch(() => {
          deleteFailed = true;
        });
      }
      hapticNotify(deleteFailed ? "warning" : "success");
      flash(
        !alsoDelete
          ? "Пользователь забанен в группе."
          : deleteFailed
            ? "Пользователь забанен, но сообщение удалить не удалось (уже удалено или нет прав)."
            : "Пользователь забанен в группе, сообщение удалено."
      );
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setActing(null);
    }
  }

  async function unbanResolvedAuthorInGroup() {
    if (!resolved || resolved.type !== "message" || !resolved.authorUserId) return;
    const userId = resolved.authorUserId;
    if (!(await confirmAction(`Снять бан с пользователя ${userId} в этой группе?`))) return;
    haptic("medium");
    setActing("unban-group");
    try {
      await fetcher(`/api/miniapp/owner/groups/${resolved.chatId}/unban`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      hapticNotify("success");
      flash("Бан снят в этой группе.");
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setActing(null);
    }
  }

  async function banResolvedUserEverywhere() {
    if (!resolved) return;
    const userId = resolved.type === "user" ? resolved.userId : resolved.authorUserId;
    if (!userId) return;
    if (!(await confirmAction(`Забанить пользователя ${userId} во ВСЕХ группах бота?`))) return;
    haptic("medium");
    setActing("ban-everywhere");
    try {
      await fetcher("/api/miniapp/owner/globalban", {
        method: "POST",
        body: JSON.stringify({ userId, reason: "Панель владельца: бан по ссылке/юзернейму" }),
      });
      hapticNotify("success");
      flash("Пользователь забанен везде.");
      loadBans();
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setActing(null);
    }
  }

  // --- Section: global bans --------------------------------------------------
  const [bans, setBans] = useState<GlobalBanEntry[] | null>(null);
  const [bansError, setBansError] = useState(false);
  const [banUserId, setBanUserId] = useState("");
  const [banReason, setBanReason] = useState("");
  const [unbanningId, setUnbanningId] = useState<number | null>(null);
  const [banningManual, setBanningManual] = useState(false);

  function loadBans() {
    fetcher<{ bans: GlobalBanEntry[] }>("/api/miniapp/owner/globalban")
      .then((d) => setBans(d.bans))
      .catch(() => setBansError(true));
  }

  useEffect(() => {
    loadBans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function banManually() {
    const id = Number(banUserId.trim());
    if (!Number.isInteger(id) || id <= 0) {
      flash("Введите корректный ID пользователя.");
      return;
    }
    const confirmed = await confirmAction(`Забанить пользователя ${id} во ВСЕХ группах бота?`);
    if (!confirmed) return;

    haptic("medium");
    setBanningManual(true);
    try {
      const result = await fetcher<{ bannedGroups: number; totalGroups: number }>(
        "/api/miniapp/owner/globalban",
        { method: "POST", body: JSON.stringify({ userId: id, reason: banReason.trim() }) }
      );
      setBanUserId("");
      setBanReason("");
      hapticNotify("success");
      flash(`Забанен в ${result.bannedGroups} из ${result.totalGroups} групп.`);
      loadBans();
    } catch {
      hapticNotify("error");
      flash("Не удалось выполнить действие. Попробуйте ещё раз.");
    } finally {
      setBanningManual(false);
    }
  }

  async function unban(entry: GlobalBanEntry) {
    const confirmed = await confirmAction(`Снять глобальный бан с пользователя ${entry.userId}?`);
    if (!confirmed) return;

    haptic("light");
    setUnbanningId(entry.userId);
    try {
      await fetcher(`/api/miniapp/owner/globalban?userId=${entry.userId}`, { method: "DELETE" });
      setBans((cur) => cur?.filter((b) => b.userId !== entry.userId) ?? cur);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
      flash("Не удалось выполнить действие. Попробуйте ещё раз.");
    } finally {
      setUnbanningId(null);
    }
  }

  // --- Section: AI rules -------------------------------------------------
  const [rules, setRules] = useState<AiRule[] | null>(null);
  const [rulesError, setRulesError] = useState(false);
  const [ruleLabel, setRuleLabel] = useState<AiRuleLabel>("violation");
  const [ruleText, setRuleText] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function loadRules() {
    fetcher<{ rules: AiRule[] }>("/api/miniapp/owner/airules")
      .then((d) => setRules(d.rules))
      .catch(() => setRulesError(true));
  }

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addRule() {
    if (!ruleText.trim()) return;
    haptic("light");
    setSavingRule(true);
    try {
      const result = await fetcher<{ rules: AiRule[] }>("/api/miniapp/owner/airules", {
        method: "POST",
        body: JSON.stringify({ label: ruleLabel, text: ruleText.trim() }),
      });
      setRules(result.rules);
      setRuleText("");
      hapticNotify("success");
    } catch (error) {
      hapticNotify("error");
      flash(error instanceof ApiError && error.message === "cap_reached" ? "Достигнут лимит правил." : "Не удалось сохранить правило.");
    } finally {
      setSavingRule(false);
    }
  }

  async function removeRule(id: string) {
    haptic("light");
    setRemovingId(id);
    try {
      const result = await fetcher<{ rules: AiRule[] }>(`/api/miniapp/owner/airules?id=${id}`, { method: "DELETE" });
      setRules(result.rules);
      hapticNotify("success");
    } catch {
      hapticNotify("error");
      flash("Не удалось удалить правило.");
    } finally {
      setRemovingId(null);
    }
  }

  // --- Section: reminders (personal checklist, not a real setting) --------
  const [reminders, setReminders] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    fetcher<{ reminders: Record<string, boolean> }>("/api/miniapp/owner/reminders")
      .then((res) => setReminders(res.reminders))
      .catch(() => setReminders({}));
  }, [fetcher]);

  async function toggleReminder(id: string, value: boolean) {
    haptic("light");
    setReminders((cur) => ({ ...cur, [id]: value }));
    try {
      await fetcher("/api/miniapp/owner/reminders", { method: "POST", body: JSON.stringify({ id, value }) });
    } catch {
      hapticNotify("error");
      flash("Не удалось сохранить напоминание.");
    }
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      {toast && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
          style={{ background: "var(--ink)", color: "#fff" }}
        >
          {toast}
        </div>
      )}

      <Card>
        <CardSection title="Ссылка на сообщение или юзернейм" subtitle="Вставьте ссылку t.me на сообщение или @юзернейм — бот сам разберётся, что с этим делать">
          <div className="flex flex-col gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://t.me/group/123 или @username"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button onClick={resolve} disabled={resolving || !input.trim()}>
              {resolving ? "Разбираем…" : "Разобрать"}
            </Button>
          </div>

          {resolved && resolved.type === "message" && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-[12px]" style={{ color: "var(--ink-secondary)" }}>
                Сообщение №{resolved.messageId} в чате {resolved.chatId}
                {resolved.authorUserId ? ` · автор ${resolved.authorUserId}` : " · автор неизвестен (бот не видел это сообщение недавно)"}
              </p>
              {resolved.text && (
                <p className="text-[12px] break-words" style={{ color: "var(--ink-muted)" }}>
                  «{resolved.text.slice(0, 200)}»
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={deleteResolvedMessage} disabled={acting !== null}>
                  {acting === "delete" ? "Удаляем…" : "Удалить сообщение"}
                </Button>
                {resolved.authorUserId && (
                  <>
                    <Button variant="danger" onClick={() => banResolvedAuthorInGroup(false)} disabled={acting !== null}>
                      {acting === "ban-group" ? "Баним…" : "Забанить автора в группе"}
                    </Button>
                    <Button variant="danger" onClick={() => banResolvedAuthorInGroup(true)} disabled={acting !== null}>
                      {acting === "ban-and-delete" ? "Выполняем…" : "Забанить и удалить"}
                    </Button>
                    <Button variant="secondary" onClick={banResolvedUserEverywhere} disabled={acting !== null}>
                      {acting === "ban-everywhere" ? "Баним…" : "Забанить во всех группах"}
                    </Button>
                    <Button variant="secondary" onClick={unbanResolvedAuthorInGroup} disabled={acting !== null}>
                      {acting === "unban-group" ? "Снимаем…" : "Разбанить в этой группе"}
                    </Button>
                  </>
                )}
              </div>
              {resolved.text && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRuleLabel("violation");
                    setRuleText(resolved.text ?? "");
                  }}
                >
                  Использовать текст для обучения ИИ ↓
                </Button>
              )}
            </div>
          )}

          {resolved && resolved.type === "user" && (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-[12px]" style={{ color: "var(--ink-secondary)" }}>
                Пользователь {resolved.userId}
                {resolved.username ? ` (@${resolved.username})` : ""}
              </p>
              <Button variant="danger" onClick={banResolvedUserEverywhere} disabled={acting !== null}>
                {acting === "ban-everywhere" ? "Баним…" : "Забанить везде"}
              </Button>
            </div>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Глобальный бан по ID" subtitle="Когда ссылки нет, но ID пользователя уже известен">
          <div className="flex flex-col gap-2">
            <input
              value={banUserId}
              onChange={(e) => setBanUserId(e.target.value)}
              placeholder="ID пользователя"
              inputMode="numeric"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <input
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Причина (необязательно)"
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="danger" onClick={banManually} disabled={banningManual}>
              {banningManual ? "Баним…" : "Забанить везде"}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Глобальные баны">
          {bansError && <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Не удалось загрузить список.</p>}
          {bans === null && !bansError && <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Загрузка…</p>}
          {bans?.length === 0 && (
            <p className="text-[13px] text-center py-6" style={{ color: "var(--ink-muted)" }}>
              Список пуст.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {bans?.map((entry) => (
              <div
                key={entry.userId}
                className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] border p-2.5"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
                    ID {entry.userId}
                  </p>
                  {entry.reason && (
                    <p className="text-[12px] mt-0.5 break-words" style={{ color: "var(--ink-secondary)" }}>
                      {entry.reason}
                    </p>
                  )}
                  <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                    {formatDate(entry.bannedAt, lang)}
                    {/* `bannedBy` is absent on rows written before it was stored — show
                        nothing for those rather than "актор 0". */}
                    {typeof entry.bannedBy === "number" && entry.bannedBy > 0 ? ` · актор ${entry.bannedBy}` : ""}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => unban(entry)} disabled={unbanningId === entry.userId}>
                  Разбанить
                </Button>
              </div>
            ))}
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Обучение ИИ" subtitle="Эти правила добавляются к промпту DeepSeek для всех групп — примеры того, что считать нарушением или, наоборот, точно разрешать">
          {rulesError && <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Не удалось загрузить правила.</p>}

          <div className="flex flex-col gap-2 mb-3">
            <div className="flex gap-2">
              <button
                onClick={() => setRuleLabel("violation")}
                className="flex-1 rounded-[var(--radius-sm)] py-2 text-[13px] font-medium border"
                style={{
                  borderColor: ruleLabel === "violation" ? "var(--accent)" : "var(--border-strong)",
                  background: ruleLabel === "violation" ? "var(--accent-wash)" : "transparent",
                  color: ruleLabel === "violation" ? "var(--accent-strong)" : "var(--ink-secondary)",
                }}
              >
                Нельзя
              </button>
              <button
                onClick={() => setRuleLabel("allowed")}
                className="flex-1 rounded-[var(--radius-sm)] py-2 text-[13px] font-medium border"
                style={{
                  borderColor: ruleLabel === "allowed" ? "var(--accent)" : "var(--border-strong)",
                  background: ruleLabel === "allowed" ? "var(--accent-wash)" : "transparent",
                  color: ruleLabel === "allowed" ? "var(--accent-strong)" : "var(--ink-secondary)",
                }}
              >
                Можно
              </button>
            </div>
            <textarea
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
              placeholder="Например: ссылки на сторонние казино/ставки — нарушение"
              rows={2}
              className="rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border resize-none"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button onClick={addRule} disabled={savingRule || !ruleText.trim()}>
              {savingRule ? "Сохраняем…" : "Добавить правило"}
            </Button>
          </div>

          {rules === null && !rulesError && <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Загрузка…</p>}
          {rules?.length === 0 && <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>Правил пока нет.</p>}
          <div className="flex flex-col gap-2">
            {rules?.map((rule) => (
              <div key={rule.id} className="flex items-start justify-between gap-2 rounded-[var(--radius-sm)] border p-2.5" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0">
                  <Badge variant={rule.label === "violation" ? "critical" : "good"}>
                    {rule.label === "violation" ? "Нельзя" : "Можно"}
                  </Badge>
                  <p className="text-[12px] mt-1 break-words" style={{ color: "var(--ink)" }}>
                    {rule.text}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => removeRule(rule.id)} disabled={removingId === rule.id}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Напоминалки">
          <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
            Личный чек-лист, не настройка бота — отметка здесь ничего не переключает в коде.
          </p>
          {/* Plain checkbox, not the <Toggle> switch used for real settings elsewhere —
              deliberately different affordance so a checked item here never reads as a
              live feature toggle. See the CardSection copy above. */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={reminders?.["daily-summary-encryption"] ?? false}
              onChange={(e) => toggleReminder("daily-summary-encryption", e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px]"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-[13px]" style={{ color: "var(--ink)" }}>
              Добавить шифрование at rest для буфера ежедневной ИИ-сводки, если срок хранения (сейчас 48ч) когда-нибудь увеличится
            </span>
          </label>
        </CardSection>
      </Card>
    </div>
  );
}

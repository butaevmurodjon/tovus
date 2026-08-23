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


export default function OwnerToolsPage() {
  const { fetcher } = useApp();
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 2600);
  }

  // --- Section A: message-link / username resolver -----------------------
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [acting, setActing] = useState<"delete" | "ban-group" | "ban-everywhere" | "ban-and-delete" | null>(null);

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
        body: JSON.stringify({ userId, reason: "God Mode: бан по ссылке/юзернейму" }),
      });
      hapticNotify("success");
      flash("Пользователь забанен везде.");
    } catch (error) {
      hapticNotify("error");
      flash(ownerActionErrorText(error));
    } finally {
      setActing(null);
    }
  }

  // --- Section B: AI rules -------------------------------------------------
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
    </div>
  );
}

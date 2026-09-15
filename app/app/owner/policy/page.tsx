"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatusScreen } from "@/components/StatusScreen";
import { haptic, hapticNotify } from "@/lib/miniapp/telegram";
import type { Policy, PolicyKey } from "@/lib/db/policy";
import type { GroupSettings } from "@/lib/db/types";

type TriState = "unset" | "on" | "off";

interface BoolField {
  key: PolicyKey;
  label: string;
}

const BOOL_GROUPS: { title: string; fields: BoolField[] }[] = [
  {
    title: "Модерация контента",
    fields: [
      { key: "profanityFilter", label: "Фильтр нецензурной лексики" },
      { key: "antispam", label: "Антиспам" },
      { key: "casCheckEnabled", label: "Проверка по базе CAS" },
      { key: "premium", label: "ИИ-проверка спорных сообщений" },
    ],
  },
  {
    title: "Вход и новые участники",
    fields: [
      { key: "captchaEnabled", label: "Капча для новых участников" },
      { key: "antiraidEnabled", label: "Антирейд-защита" },
      { key: "joinRequestCaptchaEnabled", label: "Капча перед одобрением заявки" },
      { key: "blockUnauthorizedBots", label: "Блокировать чужих ботов" },
    ],
  },
  {
    title: "Наказания",
    fields: [
      { key: "warnEscalationEnabled", label: "Эскалация предупреждений" },
      { key: "purgeMessagesOnBan", label: "Чистить сообщения при бане" },
    ],
  },
  {
    title: "Прочее",
    fields: [
      { key: "monthlyDigestEnabled", label: "Ежемесячная сводка" },
      { key: "deleteServiceMessages", label: "Удалять сообщения о входе/выходе" },
      { key: "adminTaggerEnabled", label: "Тегер @admin" },
    ],
  },
];

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "unset", label: "Дефолт" },
  { value: "delete", label: "Удалить" },
  { value: "warn", label: "Предупредить" },
  { value: "mute", label: "Замьютить" },
  { value: "ban", label: "Забанить" },
];

const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: "off", label: "Выкл" },
  { value: "unset", label: "Дефолт" },
  { value: "on", label: "Вкл" },
];

function triFromPolicy(policy: Policy, key: PolicyKey): TriState {
  const v = policy[key as keyof Policy];
  if (v === undefined) return "unset";
  return v ? "on" : "off";
}

/**
 * Bot-wide default policy (FAANG-audit §5, built 2026-09-15 after the owner
 * explicitly said not to hold back on risk). A field left "Дефолт" here
 * falls through to DEFAULT_GROUP_SETTINGS; setting it applies to every group
 * that has never explicitly touched that field itself — which today means
 * new groups only (see lib/db/groups.ts's getGroupSettings for exactly why
 * every group registered before this shipped is unaffected, by design).
 * Covers the highest-value moderation-posture fields, not the full
 * eligible-key list in lib/db/policy.ts — the backend supports all of them
 * already, this UI can grow into the rest later without another backend
 * change.
 *
 * Owner-only screen — deliberately not i18n'd, same convention as
 * /app/owner/actions (see that file's comment): the owner is one person,
 * Russian-speaking.
 */
export default function OwnerPolicyPage() {
  const { fetcher } = useApp();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast((cur) => (cur === text ? null : cur)), 2200);
  }

  useEffect(() => {
    fetcher<{ policy: Policy }>("/api/miniapp/owner/policy")
      .then((d) => setPolicy(d.policy))
      .catch(() => setError(true));
  }, [fetcher]);

  async function setBool(key: PolicyKey, next: TriState) {
    if (busyKey) return;
    haptic("light");
    setBusyKey(key);
    const previous = policy;
    setPolicy((cur) => {
      if (!cur) return cur;
      const copy = { ...cur } as Record<string, unknown>;
      if (next === "unset") delete copy[key];
      else copy[key] = next === "on";
      return copy as Policy;
    });
    try {
      if (next === "unset") {
        await fetcher("/api/miniapp/owner/policy", { method: "POST", body: JSON.stringify({ key, clear: true }) });
      } else {
        await fetcher("/api/miniapp/owner/policy", {
          method: "POST",
          body: JSON.stringify({ key, value: next === "on" }),
        });
      }
      hapticNotify("success");
    } catch {
      setPolicy(previous);
      hapticNotify("error");
      flash("Не удалось сохранить. Попробуйте ещё раз.");
    } finally {
      setBusyKey(null);
    }
  }

  async function setAction(value: string) {
    if (busyKey) return;
    haptic("light");
    setBusyKey("action");
    const previous = policy;
    setPolicy((cur) => {
      if (!cur) return cur;
      const copy = { ...cur } as Record<string, unknown>;
      if (value === "unset") delete copy.action;
      else copy.action = value;
      return copy as Policy;
    });
    try {
      if (value === "unset") {
        await fetcher("/api/miniapp/owner/policy", {
          method: "POST",
          body: JSON.stringify({ key: "action", clear: true }),
        });
      } else {
        await fetcher("/api/miniapp/owner/policy", {
          method: "POST",
          body: JSON.stringify({ key: "action", value: value as GroupSettings["action"] }),
        });
      }
      hapticNotify("success");
    } catch {
      setPolicy(previous);
      hapticNotify("error");
      flash("Не удалось сохранить. Попробуйте ещё раз.");
    } finally {
      setBusyKey(null);
    }
  }

  if (error) return <StatusScreen title="Ошибка соединения" />;
  if (!policy) return <StatusScreen title="Загрузка…" />;

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
        <CardSection title="Политика по умолчанию" subtitle="Применяется только к группам, которые сами не меняли это поле. Настройка конкретной группы всегда важнее политики.">
          <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            У ботa сейчас {Object.keys(policy).length === 0 ? "нет активных полей политики" : `${Object.keys(policy).length} активных полей политики`}.
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="Действие при нарушении">
          <div style={{ opacity: busyKey === "action" ? 0.5 : 1 }}>
            <SegmentedControl
              value={(policy.action as string | undefined) ?? "unset"}
              onChange={setAction}
              columns={ACTION_OPTIONS.length}
              options={ACTION_OPTIONS}
            />
          </div>
        </CardSection>
      </Card>

      {BOOL_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardSection title={group.title}>
            <div className="flex flex-col gap-3">
              {group.fields.map((field) => (
                <div key={field.key} style={{ opacity: busyKey === field.key ? 0.5 : 1 }}>
                  <p className="text-[13px] mb-1.5" style={{ color: "var(--ink)" }}>
                    {field.label}
                  </p>
                  <SegmentedControl<TriState>
                    value={triFromPolicy(policy, field.key)}
                    onChange={(v) => setBool(field.key, v)}
                    columns={3}
                    options={TRI_OPTIONS}
                  />
                </div>
              ))}
            </div>
          </CardSection>
        </Card>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";

interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
}

export default function GroupBroadcastPage() {
  const { t, fetcher } = useApp();
  const { chatId } = useGroup();
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetcher<{ targetCount: number }>(`/api/miniapp/groups/${chatId}/broadcast`)
      .then((d) => !cancelled && setTargetCount(d.targetCount))
      .catch(() => !cancelled && setTargetCount(0));
    return () => {
      cancelled = true;
    };
  }, [chatId, fetcher]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200);
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || !targetCount) return;
    const confirmed = await confirmAction(t("miniapp.groupBroadcastConfirm", { count: targetCount }));
    if (!confirmed) return;

    haptic("medium");
    setSending(true);
    setResult(null);
    try {
      const data = await fetcher<BroadcastResult>(`/api/miniapp/groups/${chatId}/broadcast`, {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
      setResult(data);
      hapticNotify("success");
      setText("");
    } catch (err) {
      hapticNotify("error");
      flash(err instanceof ApiError && err.status === 429 ? t("miniapp.groupBroadcastRateLimited") : t("miniapp.errorToast"));
    } finally {
      setSending(false);
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
        <CardSection title={t("miniapp.groupBroadcastTitle")} subtitle={t("miniapp.groupBroadcastHint")}>
          {targetCount === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.groupBroadcastEmpty")}
            </p>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("miniapp.groupBroadcastPlaceholder")}
                rows={5}
                className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border resize-none"
                style={{ borderColor: "var(--border-strong)" }}
              />
              <div className="mt-3">
                <Button variant="primary" onClick={send} disabled={sending || !text.trim() || !targetCount}>
                  {sending ? t("miniapp.groupBroadcastSending") : t("miniapp.groupBroadcastSend")}
                </Button>
              </div>
            </>
          )}
        </CardSection>
      </Card>

      {result && (
        <Card>
          <CardSection title={t("miniapp.groupBroadcastResultTitle")}>
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>
              {t("miniapp.groupBroadcastResultLine", {
                sent: result.sent,
                total: result.total,
                failed: result.failed,
              })}
            </p>
          </CardSection>
        </Card>
      )}
    </div>
  );
}

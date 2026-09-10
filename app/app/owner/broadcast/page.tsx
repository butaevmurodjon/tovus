"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";

interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
}

export default function OwnerBroadcastPage() {
  const { t, fetcher } = useApp();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200);
  }

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const confirmed = await confirmAction(t("miniapp.ownerBroadcastConfirm"));
    if (!confirmed) return;

    haptic("medium");
    setSending(true);
    setResult(null);
    try {
      const data = await fetcher<BroadcastResult>("/api/miniapp/owner/broadcast", {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
      setResult(data);
      hapticNotify("success");
      setText("");
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
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
        <CardSection title={t("miniapp.ownerBroadcastTitle")} subtitle={t("miniapp.ownerBroadcastHint")}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("miniapp.ownerBroadcastPlaceholder")}
            rows={5}
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border resize-none"
            style={{ borderColor: "var(--border-strong)" }}
          />
          <div className="mt-3">
            <Button variant="primary" onClick={send} disabled={sending || !text.trim()}>
              {sending ? t("miniapp.ownerBroadcastSending") : t("miniapp.ownerBroadcastSend")}
            </Button>
          </div>
        </CardSection>
      </Card>

      {result && (
        <Card>
          <CardSection title={t("miniapp.ownerBroadcastResultTitle")}>
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>
              {t("miniapp.ownerBroadcastResultLine", {
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

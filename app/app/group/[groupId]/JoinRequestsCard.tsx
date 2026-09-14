"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";

interface PendingJoinRequest {
  userId: number;
  displayName: string;
  username: string | null;
  requestedAt: number;
}

/**
 * ROADMAP.md §7.3 "Массовое принятие/отклонение заявок" — only ever shown
 * when there's something to review (see the `entries.length === 0` early
 * return): a group without manual-approval mode on, or one where captcha
 * already resolves every request itself, simply never accumulates anything
 * here, so this card stays invisible for the common case rather than
 * cluttering every group's screen with an empty list.
 */
export function JoinRequestsCard({ chatId }: { chatId: number }) {
  const { t, fetcher } = useApp();
  const [entries, setEntries] = useState<PendingJoinRequest[] | null>(null);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);

  const load = useCallback(() => {
    fetcher<{ entries: PendingJoinRequest[] }>(`/api/miniapp/groups/${chatId}/joinrequests`)
      .then((res) => setEntries(res.entries))
      .catch(() => setEntries([]));
  }, [chatId, fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: "approve" | "decline") => {
    if (!entries || entries.length === 0) return;
    const confirmKey = action === "approve" ? "miniapp.joinRequestsConfirmApprove" : "miniapp.joinRequestsConfirmDecline";
    const ok = await confirmAction(t(confirmKey, { count: entries.length }));
    if (!ok) return;
    haptic();
    setBusy(action);
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/joinrequests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userIds: "all" }),
      });
      hapticNotify("success");
      load();
    } catch {
      hapticNotify("error");
    } finally {
      setBusy(null);
    }
  };

  if (!entries || entries.length === 0) return null;

  return (
    <Card>
      <CardSection title={t("miniapp.joinRequestsTitle")}>
        <p className="text-[12px] mb-3" style={{ color: "var(--ink-muted)" }}>
          {t("miniapp.joinRequestsHint", { count: entries.length })}
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => act("approve")} disabled={busy !== null} className="flex-1">
            {busy === "approve" ? t("common.loading") : t("miniapp.joinRequestsApproveAll")}
          </Button>
          <Button variant="secondary" onClick={() => act("decline")} disabled={busy !== null} className="flex-1">
            {busy === "decline" ? t("common.loading") : t("miniapp.joinRequestsDeclineAll")}
          </Button>
        </div>
      </CardSection>
    </Card>
  );
}

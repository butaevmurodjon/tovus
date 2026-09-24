"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Button } from "@/components/Button";
import { confirmAction, haptic, hapticNotify } from "@/lib/miniapp/telegram";

/**
 * Chat-wide "read-only mode" (Combot's channel-mode / most top anti-spam
 * bots' "lock") — the "someone's raiding right now" emergency button,
 * distinct from every per-user punishment elsewhere in the app: restricts
 * ALL non-admins from posting via setChatPermissions. Always shown (unlike
 * JoinRequestsCard, which hides when empty) — this is a switch, not an
 * inbox, and an admin mid-raid needs to find it without wondering whether
 * it's currently visible. Same /lock, /unlock the group chat itself
 * exposes as commands — see lib/telegram/lockdown.ts.
 */
export function LockdownCard({ chatId }: { chatId: number }) {
  const { t, fetcher } = useApp();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetcher<{ locked: boolean }>(`/api/miniapp/groups/${chatId}/lockdown`)
      .then((res) => setLocked(res.locked))
      .catch(() => setLocked(null));
  }, [chatId, fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (locked === null) return;
    const nextAction = locked ? "unlock" : "lock";
    const question = locked ? t("miniapp.lockdownConfirmUnlock") : t("miniapp.lockdownConfirmLock");
    if (!(await confirmAction(question))) return;
    haptic("medium");
    setBusy(true);
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/lockdown`, {
        method: "POST",
        body: JSON.stringify({ action: nextAction }),
      });
      hapticNotify("success");
      load();
    } catch {
      hapticNotify("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardSection title={t("miniapp.lockdownTitle")} subtitle={t("miniapp.lockdownHint")}>
        <Button variant={locked ? "secondary" : "danger"} onClick={toggle} disabled={locked === null || busy}>
          {busy ? t("common.loading") : locked ? t("miniapp.lockdownUnlock") : t("miniapp.lockdownLock")}
        </Button>
      </CardSection>
    </Card>
  );
}

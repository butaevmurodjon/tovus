"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { PermissionWarning } from "@/components/PermissionWarning";
import { Collapsible } from "@/components/Collapsible";
import { haptic, hapticNotify, openInvoice } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";
import { isProActive, formatPlanDate, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import type { GroupSettings, ViolationAction } from "@/lib/db/types";

export default function GroupSettingsPage() {
  const { t, fetcher, lang } = useApp();
  const { settings, missingPermissions, proFeaturesEligible, updateSettings, chatId, refresh } = useGroup();
  const [toast, setToast] = useState<string | null>(null);
  const [logChannelInput, setLogChannelInput] = useState(settings?.logChannelId?.toString() ?? "");
  const [welcomeInput, setWelcomeInput] = useState(settings?.welcomeMessage ?? "");
  const [savingLogChannel, setSavingLogChannel] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  if (!settings) return null;

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 1600);
  }

  // Updates apply to the UI immediately (see GroupProvider.updateSettings) — no
  // blocking spinner needed here, just haptic feedback and an error toast if the
  // background request ends up failing.
  async function toggle(key: "profanityFilter" | "antispam" | "premium", value: boolean) {
    haptic("light");
    try {
      await updateSettings({ [key]: value } as never);
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function setAction(action: ViolationAction) {
    haptic("light");
    try {
      await updateSettings({ action });
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function saveLogChannel() {
    const trimmed = logChannelInput.trim();
    const logChannelId = trimmed === "" ? null : Number(trimmed);
    if (logChannelId !== null && !Number.isFinite(logChannelId)) return;
    setSavingLogChannel(true);
    try {
      await updateSettings({ logChannelId });
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setSavingLogChannel(false);
    }
  }

  async function saveWelcome() {
    const trimmed = welcomeInput.trim();
    setSavingWelcome(true);
    try {
      await updateSettings({
        welcomeMessage: trimmed === "" ? null : trimmed,
        welcomeEnabled: trimmed !== "",
      });
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setSavingWelcome(false);
    }
  }

  async function toggleProFeature(key: "captchaEnabled" | "antiraidEnabled", value: boolean) {
    haptic("light");
    try {
      await updateSettings({ [key]: value } as never);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        hapticNotify("error");
        flash(t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS }));
      } else {
        hapticNotify("error");
        flash(t("miniapp.errorToast"));
      }
    }
  }

  async function handleUpgrade() {
    haptic("light");
    setUpgrading(true);
    try {
      const { link } = await fetcher<{ link: string }>(`/api/miniapp/groups/${chatId}/upgrade`, { method: "POST" });
      openInvoice(link, (status) => {
        if (status === "paid") {
          hapticNotify("success");
          // The webhook that actually flips `plan`/`planExpiresAt` in storage races
          // this callback — a single fixed-delay refresh can land before it commits
          // and show the group as still on the free plan. Poll with backoff instead
          // of guessing one delay that works for every payment.
          pollForProActivation();
        }
      });
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setUpgrading(false);
    }
  }

  function pollForProActivation(attempt = 0) {
    const delays = [1200, 1800, 2500, 3500];
    if (attempt >= delays.length) return;
    setTimeout(async () => {
      // Check freshly-fetched settings directly rather than the `settings` closed
      // over at call time — `refresh()` only schedules a state update, so reading
      // context state right after calling it would still see the stale value.
      try {
        const data = await fetcher<{ settings: GroupSettings }>(`/api/miniapp/groups/${chatId}`);
        if (isProActive(data.settings)) {
          refresh();
        } else {
          pollForProActivation(attempt + 1);
        }
      } catch {
        pollForProActivation(attempt + 1);
      }
    }, delays[attempt]);
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

      <PermissionWarning missing={missingPermissions} action={settings.action} t={t} />

      <Card>
        <CardSection title={t("miniapp.planTitle")}>
          <div className="flex items-center justify-between">
            <Badge variant={isProActive(settings) ? "accent" : "neutral"}>
              {isProActive(settings)
                ? `${t("miniapp.planProBadge")} · ${t("miniapp.planExpiresOn", {
                    date: formatPlanDate(settings.planExpiresAt, lang),
                  })}`
                : t("miniapp.planFreeBadge")}
            </Badge>
            {!isProActive(settings) && (
              <Button variant="primary" onClick={handleUpgrade} disabled={upgrading}>
                {t("miniapp.upgradeButton")}
              </Button>
            )}
          </div>
          {!isProActive(settings) && (
            <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.upgradeHint")}
            </p>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection>
          <Row label={t("miniapp.filterProfanity")}>
            <Toggle checked={settings.profanityFilter} onChange={(v) => toggle("profanityFilter", v)} />
          </Row>
          <Divider />
          <Row label={t("miniapp.antispam")}>
            <Toggle checked={settings.antispam} onChange={(v) => toggle("antispam", v)} />
          </Row>
          <Divider />
          <Row label={t("miniapp.premiumMode")}>
            <Toggle checked={settings.premium} onChange={(v) => toggle("premium", v)} />
          </Row>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.premiumHint")}
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.violationAction")}>
          <SegmentedControl
            value={settings.action}
            onChange={setAction}
            columns={2}
            options={[
              { value: "delete", label: t("miniapp.actionDelete") },
              { value: "warn", label: t("miniapp.actionWarn") },
              { value: "mute", label: t("miniapp.actionMute") },
              { value: "ban", label: t("miniapp.actionBan") },
            ]}
          />
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.logChannelTitle")} subtitle={t("miniapp.logChannelHint")}>
          <div className="flex gap-2">
            <input
              value={logChannelInput}
              onChange={(e) => setLogChannelInput(e.target.value)}
              placeholder={t("miniapp.logChannelPlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="primary" onClick={saveLogChannel} disabled={savingLogChannel}>
              {t("common.save")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.welcomeTitle")} subtitle={t("miniapp.welcomeHint")}>
          <div className="flex gap-2">
            <input
              value={welcomeInput}
              onChange={(e) => setWelcomeInput(e.target.value)}
              placeholder={t("miniapp.welcomePlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="primary" onClick={saveWelcome} disabled={savingWelcome}>
              {t("common.save")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection>
          <Collapsible title={t("miniapp.advancedSection")}>
            <Row
              label={
                <span className="flex items-center gap-1.5">
                  {t("miniapp.captchaTitle")}
                  {!proFeaturesEligible && <Badge variant="warning">PRO</Badge>}
                </span>
              }
            >
              <Toggle checked={settings.captchaEnabled} onChange={(v) => toggleProFeature("captchaEnabled", v)} />
            </Row>
            <ProFeatureHint
              eligible={proFeaturesEligible}
              enabled={settings.captchaEnabled}
              normalHint={t("miniapp.captchaHint")}
              t={t}
              className="mb-3"
            />
            <Divider />
            <Row
              label={
                <span className="flex items-center gap-1.5">
                  {t("miniapp.antiraidTitle")}
                  {!proFeaturesEligible && <Badge variant="warning">PRO</Badge>}
                </span>
              }
            >
              <Toggle checked={settings.antiraidEnabled} onChange={(v) => toggleProFeature("antiraidEnabled", v)} />
            </Row>
            <ProFeatureHint
              eligible={proFeaturesEligible}
              enabled={settings.antiraidEnabled}
              normalHint={t("miniapp.antiraidHint")}
              t={t}
            />
          </Collapsible>
        </CardSection>
      </Card>
    </div>
  );
}

function ProFeatureHint({
  eligible,
  enabled,
  normalHint,
  t,
  className = "",
}: {
  eligible: boolean;
  enabled: boolean;
  normalHint: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  className?: string;
}) {
  if (eligible) {
    return (
      <p className={`text-[12px] mt-1 ${className}`} style={{ color: "var(--ink-muted)" }}>
        {normalHint}
      </p>
    );
  }
  // Distinct from the plain "locked" case: this setting is ON in storage but not
  // currently being enforced (group outgrew the free tier / subscription lapsed) —
  // silently doing nothing here would be confusing, since the toggle still shows "on".
  if (enabled) {
    return (
      <p className={`text-[12px] mt-1 ${className}`} style={{ color: "#a3401f" }}>
        {t("miniapp.proNotEnforcedHint", { limit: FREE_TIER_MAX_MEMBERS })}
      </p>
    );
  }
  return (
    <p className={`text-[12px] mt-1 ${className}`} style={{ color: "var(--ink-muted)" }}>
      {t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS })}
    </p>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[14px]" style={{ color: "var(--ink)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px" style={{ background: "var(--border)" }} />;
}

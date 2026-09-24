"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { StatTile } from "@/components/StatTile";
import { PermissionWarning } from "@/components/PermissionWarning";
import { SettingsLink } from "@/components/SettingsLink";
import { Row, ProFeatureHint } from "@/components/SettingsPrimitives";
import { JoinRequestsCard } from "./JoinRequestsCard";
import { LockdownCard } from "./LockdownCard";
import { useToast, Toast } from "@/lib/miniapp/useToast";
import { haptic, hapticNotify, openInvoice, openTelegramLink } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";
import { isProActive, formatPlanDate, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import {
  STRICTNESS_LEVELS,
  STRICTNESS_PRESETS,
  detectStrictnessLevel,
  type StrictnessLevel,
} from "@/lib/moderation/strictnessPresets";
import type { GroupSettings } from "@/lib/db/types";

/**
 * Settings INDEX (FAANG-audit PR-1) — the old single ~44-control page split
 * into this index + 5 subscreens under settings/*. Material's own guidance
 * for 15+ settings: group under subscreens, and each index row's status
 * text must show current VALUE, not a description (see the status*()
 * helpers below and SettingsLink's doc comment). What stays here: the
 * overview, the one-tap strictness preset (covers ~80% of cases), plan/PRO,
 * the join-requests inbox (a self-hiding action, not a setting), federation
 * (a cross-group feature, not this group's own setting) and the
 * pre-PRO attribution toggle.
 */
export default function GroupSettingsPage() {
  const { t, fetcher, lang } = useApp();
  const {
    settings,
    missingPermissions,
    federationEligible,
    whitelistCount,
    customWordsCount,
    allowlistCount,
    violationsToday,
    supportUrl,
    updateSettings,
    chatId,
    refresh,
  } = useGroup();
  const { toast, flash } = useToast();
  const [upgrading, setUpgrading] = useState(false);
  // §3 audit: pollForProActivation below is a setTimeout chain that used to run
  // unconditionally to completion — `cancelled` stops it from calling `refresh()`
  // after this page unmounts, `active` stops a second click from starting a
  // second overlapping poll cycle while one is already in flight.
  const upgradePollRef = useRef({ cancelled: false, active: false });

  useEffect(() => {
    // Captured once, not re-read as upgradePollRef.current inside the cleanup —
    // safe only because .current is mutated in place elsewhere and never
    // reassigned; if that ever changes, this closure would mutate an orphaned object.
    const pollState = upgradePollRef.current;
    return () => {
      pollState.cancelled = true;
    };
  }, []);

  if (!settings) return null;

  // Only federationEnabled is still server-gated (`gateKeys` in the PATCH
  // route) — captcha/antiraid went free in the Phase 1 re-cut.
  async function toggleFederation(value: boolean) {
    haptic("light");
    try {
      const rejected = await updateSettings({ federationEnabled: value } as never);
      if (rejected.includes("federationEnabled")) {
        hapticNotify("error");
        flash(t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS }));
      }
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

  async function setAttributionEnabled(value: boolean) {
    haptic("light");
    try {
      await updateSettings({ attributionEnabled: value });
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  // §6.5 priority 5: one tap sets the whole bundle in strictnessPresets.ts.
  async function applyStrictness(level: StrictnessLevel) {
    haptic("medium");
    try {
      const rejected = await updateSettings(STRICTNESS_PRESETS[level]);
      if (rejected.length > 0) {
        hapticNotify("error");
        flash(t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS }));
        return;
      }
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function handleUpgrade() {
    if (upgradePollRef.current.active) return;
    haptic("light");
    setUpgrading(true);
    try {
      const { link } = await fetcher<{ link: string }>(`/api/miniapp/groups/${chatId}/upgrade`, { method: "POST" });
      openInvoice(link, (status) => {
        if (status === "paid") {
          hapticNotify("success");
          upgradePollRef.current.active = true;
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
    if (attempt >= delays.length) {
      upgradePollRef.current.active = false;
      return;
    }
    setTimeout(async () => {
      if (upgradePollRef.current.cancelled) return;
      try {
        const data = await fetcher<{ settings: GroupSettings }>(`/api/miniapp/groups/${chatId}`);
        if (upgradePollRef.current.cancelled) return;
        if (isProActive(data.settings)) {
          refresh();
          upgradePollRef.current.active = false;
        } else {
          pollForProActivation(attempt + 1);
        }
      } catch {
        if (!upgradePollRef.current.cancelled) pollForProActivation(attempt + 1);
      }
    }, delays[attempt]);
  }

  // Overview status card (§6.5 priority 5): "protection" is the base
  // content-filtering layer (profanity/spam) — deliberately not tied to
  // casCheck/premium/captcha, which are opt-in refinements on top of it.
  const protectionOn = settings.profanityFilter || settings.antispam;
  const currentStrictness = detectStrictnessLevel(settings);

  // Status subtitles for the 5 subscreen links — real current values, not
  // descriptions (Material's settings guidance: the secondary line under a
  // settings entry shows state). Deliberately terse (2-3 short facts max).
  const contentParts = [
    settings.profanityFilter && t("miniapp.statusWordProfanity"),
    settings.antispam && t("miniapp.statusWordAntispam"),
    settings.casCheckEnabled && t("miniapp.statusWordCas"),
  ].filter(Boolean) as string[];
  const contentStatus = contentParts.length > 0 ? contentParts.join(" · ") : t("common.off");

  const antiraidEffective = settings.antiraidEnabled || settings.antiraidAuto;
  const entryStatus = [
    `${t("miniapp.statusWordCaptcha")} ${settings.captchaEnabled ? t("common.on") : t("common.off")}`,
    `${t("miniapp.statusWordAntiraid")} ${antiraidEffective ? t("common.on") : t("common.off")}`,
  ].join(" · ");

  const actionLabelKey = {
    delete: "actionDelete",
    warn: "actionWarn",
    mute: "actionMute",
    kick: "actionKick",
    ban: "actionBan",
  }[settings.action];
  const punishmentsStatus = [
    t(`miniapp.${actionLabelKey}`),
    settings.warnEscalationEnabled && t("miniapp.statusWarnLimit", { limit: settings.warnLimit }),
  ]
    .filter(Boolean)
    .join(" · ");

  const notificationsParts = [
    settings.nightModeEnabled &&
      t("miniapp.statusNightMode", {
        start: settings.nightModeStartHour,
        end: settings.nightModeEndHour,
      }),
    settings.logChannelId && t("miniapp.statusLogChannelOn"),
  ].filter(Boolean) as string[];
  const notificationsStatus = notificationsParts.length > 0 ? notificationsParts.join(" · ") : t("common.off");

  const listsStatus = t("miniapp.statusListsSummary", {
    whitelist: whitelistCount,
    words: customWordsCount,
    allow: allowlistCount,
  });

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />

      <Card>
        <CardSection title={t("miniapp.overviewTitle")}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Badge variant={protectionOn ? "good" : "warning"}>
              {protectionOn ? t("miniapp.overviewProtectionOn") : t("miniapp.overviewProtectionOff")}
            </Badge>
            <Badge variant={missingPermissions.length === 0 ? "good" : "critical"}>
              {missingPermissions.length === 0
                ? t("miniapp.overviewPermissionsOk")
                : t("miniapp.overviewPermissionsIssue")}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <StatTile label={t("miniapp.ownerStatViolationsToday")} value={violationsToday} accent />
            <StatTile label={t("miniapp.overviewWhitelistCount")} value={whitelistCount} />
          </div>
        </CardSection>
      </Card>

      <PermissionWarning missing={missingPermissions} action={settings.action} t={t} />

      <Card>
        <CardSection title={t("miniapp.strictnessTitle")} subtitle={t("miniapp.strictnessHint")}>
          <SegmentedControl
            value={currentStrictness}
            onChange={applyStrictness}
            columns={STRICTNESS_LEVELS.length}
            options={[
              { value: "mild", label: t("miniapp.strictnessMild") },
              { value: "balanced", label: t("miniapp.strictnessBalanced") },
              { value: "strict", label: t("miniapp.strictnessStrict") },
            ]}
          />
          {currentStrictness === null && (
            <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.strictnessCustomHint")}
            </p>
          )}
        </CardSection>
      </Card>

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

      <div className="flex flex-col gap-2">
        <SettingsLink
          href={`/app/group/${chatId}/settings/content`}
          icon="🛡"
          title={t("miniapp.sectionProtection")}
          status={contentStatus}
        />
        <SettingsLink
          href={`/app/group/${chatId}/settings/entry`}
          icon="🚪"
          title={t("miniapp.sectionEntry")}
          status={entryStatus}
        />
        <SettingsLink
          href={`/app/group/${chatId}/settings/punishments`}
          icon="⚖️"
          title={t("miniapp.sectionPunishments")}
          status={punishmentsStatus}
        />
        <SettingsLink
          href={`/app/group/${chatId}/settings/notifications`}
          icon="🔔"
          title={t("miniapp.sectionChatNotifications")}
          status={notificationsStatus}
        />
        <SettingsLink
          href={`/app/group/${chatId}/settings/lists`}
          icon="📋"
          title={t("miniapp.sectionLists")}
          status={listsStatus}
        />
      </div>

      <JoinRequestsCard chatId={chatId} />

      <LockdownCard chatId={chatId} />

      {/* Федерация: отдельная тема (общий бан-лист МЕЖДУ группами), не про
          эту группу саму по себе — своя карточка, а не строчка в свалке. */}
      <Card>
        <CardSection>
          <Row
            label={
              <span className="flex items-center gap-1.5">
                {t("miniapp.federationTitle")}
                {!federationEligible && <Badge variant="warning">PRO</Badge>}
              </span>
            }
          >
            <Toggle checked={settings.federationEnabled} onChange={toggleFederation} />
          </Row>
          <ProFeatureHint
            eligible={federationEligible}
            enabled={settings.federationEnabled}
            normalHint={t("miniapp.federationHint")}
            t={t}
          />
          {settings.federationEnabled && (
            <Link
              href={`/app/group/${chatId}/broadcast`}
              className="mt-3 block text-center rounded-[var(--radius-sm)] px-4 py-2.5 text-[14px] font-medium"
              style={{ background: "#f2f1ee", color: "var(--ink)" }}
            >
              {t("miniapp.groupBroadcastLink")}
            </Link>
          )}
        </CardSection>
      </Card>

      {/* Only meaningful pre-PRO (the attribution button never shows once
          PRO is active — see notifyChat) — hidden outright for PRO groups
          rather than rendering an empty titled card. */}
      {!isProActive(settings) && (
        <Card>
          <CardSection>
            <Row label={t("miniapp.attributionTitle")}>
              <Toggle checked={settings.attributionEnabled} onChange={setAttributionEnabled} />
            </Row>
            <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.attributionHint")}
            </p>
          </CardSection>
        </Card>
      )}

      {supportUrl && (
        <Card>
          <CardSection>
            <Button
              variant="secondary"
              onClick={() => {
                haptic();
                openTelegramLink(supportUrl);
              }}
              className="w-full"
            >
              {t("bot.supportEntryButton")}
            </Button>
          </CardSection>
        </Card>
      )}
    </div>
  );
}

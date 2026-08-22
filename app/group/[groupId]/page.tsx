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
import { PermissionWarning } from "@/components/PermissionWarning";
import { Collapsible } from "@/components/Collapsible";
import { haptic, hapticNotify, openInvoice } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";
import { isProActive, formatPlanDate, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import type { GroupSettings } from "@/lib/db/types";

const WARN_LIMIT_PRESETS = [3, 5, 10];

const VOTE_BAN_THRESHOLD_PRESETS = [3, 5, 10];

const RESTRICT_MINUTES_PRESETS = [5, 10, 30, 60];

const CAPTCHA_TIMEOUT_PRESETS = [60, 120, 300];

const PRO_GRANT_DAYS = [30, 90, 365];

/** Module scope (not the component body) so the current-time read here isn't
 * flagged as an impure render call — this only ever runs from a click handler. */
function extendExpiry(currentExpiresAt: number | null, active: boolean, days: number): number {
  const base = active && currentExpiresAt ? currentExpiresAt : Date.now();
  return base + days * 24 * 60 * 60 * 1000;
}

export default function GroupSettingsPage() {
  const { t, fetcher, lang, isOwner } = useApp();
  const { settings, missingPermissions, proFeaturesEligible, updateSettings, chatId, refresh } = useGroup();
  const [toast, setToast] = useState<string | null>(null);
  const [logChannelInput, setLogChannelInput] = useState(settings?.logChannelId?.toString() ?? "");
  const [welcomeInput, setWelcomeInput] = useState(settings?.welcomeMessage ?? "");
  const [rulesTextInput, setRulesTextInput] = useState(settings?.rulesText ?? "");
  const [savingLogChannel, setSavingLogChannel] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [savingRulesText, setSavingRulesText] = useState(false);
  const [nightStartInput, setNightStartInput] = useState(String(settings?.nightModeStartHour ?? 23));
  const [nightEndInput, setNightEndInput] = useState(String(settings?.nightModeEndHour ?? 7));
  const [savingNightHours, setSavingNightHours] = useState(false);
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

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 1600);
  }

  // Updates apply to the UI immediately (see GroupProvider.updateSettings) — no
  // blocking spinner needed here, just haptic feedback and an error toast if the
  // background request ends up failing. Shared by every single-field setting
  // below (toggles, the action picker, warn escalation) — they all differ only
  // in which key/value they send.
  async function setField<K extends keyof GroupSettings>(key: K, value: GroupSettings[K]) {
    haptic("light");
    try {
      await updateSettings({ [key]: value } as never);
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
      const rejected = await updateSettings({ logChannelId });
      if (rejected.includes("logChannelId")) {
        hapticNotify("error");
        flash(t("miniapp.logChannelNotAdmin"));
      } else {
        flash(t("miniapp.savedToast"));
      }
    } catch (err) {
      if (err instanceof ApiError && err.message === "log channel not admin") {
        hapticNotify("error");
        flash(t("miniapp.logChannelNotAdmin"));
      } else {
        hapticNotify("error");
        flash(t("miniapp.errorToast"));
      }
    } finally {
      setSavingLogChannel(false);
    }
  }

  async function saveNightHours() {
    const [startRaw, endRaw] = [nightStartInput.trim(), nightEndInput.trim()];
    const [start, end] = [Number(startRaw), Number(endRaw)];
    const isHour = (raw: string, h: number) => raw !== "" && Number.isInteger(h) && h >= 0 && h <= 23;
    if (!isHour(startRaw, start) || !isHour(endRaw, end)) return;
    setSavingNightHours(true);
    try {
      await updateSettings({ nightModeStartHour: start, nightModeEndHour: end });
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setSavingNightHours(false);
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

  async function saveRulesText() {
    const trimmed = rulesTextInput.trim();
    setSavingRulesText(true);
    try {
      await updateSettings({ rulesText: trimmed === "" ? null : trimmed });
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setSavingRulesText(false);
    }
  }

  async function toggleProFeature(key: "captchaEnabled" | "antiraidEnabled" | "federationEnabled", value: boolean) {
    haptic("light");
    try {
      // A single-key patch that's ineligible always empties the server's patch
      // and throws 402 today (caught below) — but `rejected` is also checked
      // here so this keeps working correctly if this ever becomes part of a
      // multi-field patch, where a rejection comes back as a 200 instead.
      const rejected = await updateSettings({ [key]: value } as never);
      if (rejected.includes(key)) {
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

  // Owner-only manual PRO override — bypasses payment entirely, unlike
  // toggleProFeature above which only flips already-purchased entitlements.
  async function grantPro(days: number) {
    if (!settings) return;
    haptic("medium");
    const planExpiresAt = extendExpiry(settings.planExpiresAt, isProActive(settings), days);
    try {
      await updateSettings({ plan: "pro", planExpiresAt });
      hapticNotify("success");
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function revokePro() {
    haptic("medium");
    try {
      await updateSettings({ plan: "free", planExpiresAt: null });
      hapticNotify("success");
      flash(t("miniapp.savedToast"));
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  async function handleUpgrade() {
    // setUpgrading(false) below (in `finally`) fires as soon as openInvoice is
    // called, well before payment completes — `active` is what actually covers
    // the whole poll-until-confirmed window, so this is the guard that stops a
    // second click from starting a second overlapping invoice+poll cycle.
    if (upgradePollRef.current.active) return;
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
      // The page may have unmounted (navigated away) since this was scheduled —
      // `refresh()` targets GroupProvider context state, which can outlive this
      // page, so without this check a stale poll would keep calling it after
      // the user left, and/or reschedule itself forever.
      if (upgradePollRef.current.cancelled) return;
      // Check freshly-fetched settings directly rather than the `settings` closed
      // over at call time — `refresh()` only schedules a state update, so reading
      // context state right after calling it would still see the stale value.
      try {
        const data = await fetcher<{ settings: GroupSettings }>(`/api/miniapp/groups/${chatId}`);
        if (upgradePollRef.current.cancelled) return; // unmounted while the fetch was in flight
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

  // The bot's /warnlimit command accepts any value 0-20, but the Mini App only
  // offers the three common presets — if the group's current limit was set via
  // the bot to something else (e.g. 7), show it as a fourth, selected option
  // instead of leaving the control blank and silently overwriting it on the
  // next unrelated tap.
  const warnLimitOptions = WARN_LIMIT_PRESETS.includes(settings.warnLimit)
    ? WARN_LIMIT_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...WARN_LIMIT_PRESETS, settings.warnLimit].map((n) => ({ value: String(n), label: String(n) }));

  const voteBanThresholdOptions = VOTE_BAN_THRESHOLD_PRESETS.includes(settings.voteBanThreshold)
    ? VOTE_BAN_THRESHOLD_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...VOTE_BAN_THRESHOLD_PRESETS, settings.voteBanThreshold].map((n) => ({ value: String(n), label: String(n) }));

  const restrictMinutesOptions = RESTRICT_MINUTES_PRESETS.includes(settings.restrictNewMembersMinutes)
    ? RESTRICT_MINUTES_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...RESTRICT_MINUTES_PRESETS, settings.restrictNewMembersMinutes].map((n) => ({
        value: String(n),
        label: String(n),
      }));

  const captchaTimeoutOptions = CAPTCHA_TIMEOUT_PRESETS.includes(settings.captchaTimeoutSeconds)
    ? CAPTCHA_TIMEOUT_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...CAPTCHA_TIMEOUT_PRESETS, settings.captchaTimeoutSeconds].map((n) => ({
        value: String(n),
        label: String(n),
      }));

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

      {isOwner && (
        <Card>
          <CardSection title={t("miniapp.ownerProControlTitle")} subtitle={t("miniapp.ownerProControlHint")}>
            <div className="flex flex-wrap gap-2">
              {PRO_GRANT_DAYS.map((days) => (
                <Button key={days} variant="secondary" onClick={() => grantPro(days)}>
                  {t("miniapp.ownerGrantProDays", { days })}
                </Button>
              ))}
              {isProActive(settings) && (
                <Button variant="danger" onClick={revokePro}>
                  {t("miniapp.ownerRevokePro")}
                </Button>
              )}
            </div>
          </CardSection>
        </Card>
      )}

      <Card>
        <CardSection>
          <Row label={t("miniapp.filterProfanity")}>
            <Toggle checked={settings.profanityFilter} onChange={(v) => setField("profanityFilter", v)} />
          </Row>
          <Divider />
          <Row label={t("miniapp.antispam")}>
            <Toggle checked={settings.antispam} onChange={(v) => setField("antispam", v)} />
          </Row>
          <Divider />
          <Row label={t("miniapp.casCheckTitle")}>
            <Toggle checked={settings.casCheckEnabled} onChange={(v) => setField("casCheckEnabled", v)} />
          </Row>
          <p className="text-[12px] mt-2 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.casCheckHint")}
          </p>
          <Divider />
          <Row label={t("miniapp.deleteServiceMessagesTitle")}>
            <Toggle
              checked={settings.deleteServiceMessages}
              onChange={(v) => setField("deleteServiceMessages", v)}
            />
          </Row>
          <p className="text-[12px] mt-2 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.deleteServiceMessagesHint")}
          </p>
          <Divider />
          <Row label={t("miniapp.restrictNewMembersTitle")}>
            <Toggle
              checked={settings.restrictNewMembersEnabled}
              onChange={(v) => setField("restrictNewMembersEnabled", v)}
            />
          </Row>
          <p className="text-[12px] mt-2 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.restrictNewMembersHint")}
          </p>
          {settings.restrictNewMembersEnabled && (
            <div className="mb-2">
              <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                {t("miniapp.restrictNewMembersMinutesLabel")}
              </p>
              <SegmentedControl
                value={String(settings.restrictNewMembersMinutes)}
                onChange={(v) => setField("restrictNewMembersMinutes", Number(v))}
                columns={restrictMinutesOptions.length}
                options={restrictMinutesOptions}
              />
            </div>
          )}
          <Divider />
          <Row label={t("miniapp.nightModeTitle")}>
            <Toggle checked={settings.nightModeEnabled} onChange={(v) => setField("nightModeEnabled", v)} />
          </Row>
          <p className="text-[12px] mt-2 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.nightModeHint")}
          </p>
          {settings.nightModeEnabled && (
            <div className="mb-2">
              <div className="flex gap-2 items-end">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                    {t("miniapp.nightModeStartLabel")}
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={nightStartInput}
                    onChange={(e) => setNightStartInput(e.target.value)}
                    className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
                    style={{ borderColor: "var(--border-strong)" }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                    {t("miniapp.nightModeEndLabel")}
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={nightEndInput}
                    onChange={(e) => setNightEndInput(e.target.value)}
                    className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
                    style={{ borderColor: "var(--border-strong)" }}
                  />
                </div>
                <Button variant="primary" onClick={saveNightHours} disabled={savingNightHours}>
                  {t("common.save")}
                </Button>
              </div>
              <p className="text-[12px] mt-1.5" style={{ color: "var(--ink-muted)" }}>
                {t("miniapp.nightModeUtcHint")}
              </p>
            </div>
          )}
          <Divider />
          <Row label={t("miniapp.premiumMode")}>
            <Toggle checked={settings.premium} onChange={(v) => setField("premium", v)} />
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
            onChange={(action) => setField("action", action)}
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
        <CardSection>
          <Row label={t("miniapp.warnEscalationTitle")}>
            <Toggle
              checked={settings.warnEscalationEnabled}
              onChange={(v) => setField("warnEscalationEnabled", v)}
            />
          </Row>
          <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.warnEscalationHint")}
          </p>
          {settings.warnEscalationEnabled && (
            <>
              <div className="mt-3">
                <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.warnLimitLabel")}
                </p>
                <SegmentedControl
                  value={String(settings.warnLimit)}
                  onChange={(v) => setField("warnLimit", Number(v))}
                  columns={WARN_LIMIT_PRESETS.includes(settings.warnLimit) ? 3 : 4}
                  options={warnLimitOptions}
                />
              </div>
              <div className="mt-3">
                <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.warnActionLabel")}
                </p>
                <SegmentedControl
                  value={settings.warnAction}
                  onChange={(action) => setField("warnAction", action)}
                  columns={2}
                  options={[
                    { value: "mute", label: t("miniapp.actionMute") },
                    { value: "ban", label: t("miniapp.actionBan") },
                  ]}
                />
              </div>
            </>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.voteBanTitle")} subtitle={t("miniapp.voteBanHint")}>
          <SegmentedControl
            value={String(settings.voteBanThreshold)}
            onChange={(v) => setField("voteBanThreshold", Number(v))}
            columns={voteBanThresholdOptions.length}
            options={voteBanThresholdOptions}
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
            {settings.captchaEnabled && (
              <>
                <div className="mb-3">
                  <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                    {t("miniapp.captchaTypeLabel")}
                  </p>
                  <SegmentedControl
                    value={settings.captchaType}
                    onChange={(v) => setField("captchaType", v)}
                    columns={3}
                    options={[
                      { value: "button", label: t("miniapp.captchaTypeButton") },
                      { value: "math", label: t("miniapp.captchaTypeMath") },
                      { value: "rules", label: t("miniapp.captchaTypeRules") },
                    ]}
                  />
                </div>
                {settings.captchaType === "rules" && (
                  <div className="mb-3">
                    <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                      {t("miniapp.rulesTextLabel")}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={rulesTextInput}
                        onChange={(e) => setRulesTextInput(e.target.value)}
                        placeholder={t("miniapp.rulesTextPlaceholder")}
                        className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
                        style={{ borderColor: "var(--border-strong)" }}
                      />
                      <Button variant="primary" onClick={saveRulesText} disabled={savingRulesText}>
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="mb-3">
                  <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                    {t("miniapp.captchaTimeoutLabel")}
                  </p>
                  <SegmentedControl
                    value={String(settings.captchaTimeoutSeconds)}
                    onChange={(v) => setField("captchaTimeoutSeconds", Number(v))}
                    columns={captchaTimeoutOptions.length}
                    options={captchaTimeoutOptions}
                  />
                </div>
              </>
            )}
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
              className="mb-3"
            />
            <Divider />
            <Row
              label={
                <span className="flex items-center gap-1.5">
                  {t("miniapp.federationTitle")}
                  {!proFeaturesEligible && <Badge variant="warning">PRO</Badge>}
                </span>
              }
            >
              <Toggle
                checked={settings.federationEnabled}
                onChange={(v) => toggleProFeature("federationEnabled", v)}
              />
            </Row>
            <ProFeatureHint
              eligible={proFeaturesEligible}
              enabled={settings.federationEnabled}
              normalHint={t("miniapp.federationHint")}
              t={t}
            />
            {settings.federationEnabled && (
              <Link
                href={`/group/${chatId}/broadcast`}
                className="mt-3 block text-center rounded-[var(--radius-sm)] px-4 py-2.5 text-[14px] font-medium"
                style={{ background: "#f2f1ee", color: "var(--ink)" }}
              >
                {t("miniapp.groupBroadcastLink")}
              </Link>
            )}
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

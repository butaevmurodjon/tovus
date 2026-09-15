"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Button } from "@/components/Button";
import { Collapsible } from "@/components/Collapsible";
import { Row, Divider, SubLabel } from "@/components/SettingsPrimitives";
import { useSettingsField } from "@/lib/miniapp/useSettingsField";
import { useToast, Toast } from "@/lib/miniapp/useToast";
import { hapticNotify } from "@/lib/miniapp/telegram";

const RESTRICT_MINUTES_PRESETS = [5, 10, 30, 60];
const CAPTCHA_TIMEOUT_PRESETS = [60, 120, 300];
const MIN_ACCOUNT_AGE_PRESETS = [0, 1, 3, 7, 30];

/** "Вход и новые участники" subscreen (PR-1 split) — everything that
 * decides who gets in and how they're screened. JoinRequestsCard itself
 * stays on the index: it's a self-hiding inbox action, not a setting. */
export default function EntrySettingsPage() {
  const { t } = useApp();
  const { settings, updateSettings } = useGroup();
  const { toast, flash } = useToast();
  const setField = useSettingsField(flash);

  const [rulesTextInput, setRulesTextInput] = useState(settings?.rulesText ?? "");
  const [savingRulesText, setSavingRulesText] = useState(false);
  const [ownerChannelInput, setOwnerChannelInput] = useState(settings?.ownerChannelUsername ?? "");
  const [savingOwnerChannel, setSavingOwnerChannel] = useState(false);

  if (!settings) return null;

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

  async function saveOwnerChannel() {
    const trimmed = ownerChannelInput.trim();
    setSavingOwnerChannel(true);
    try {
      const rejected = await updateSettings({ ownerChannelUsername: trimmed === "" ? null : trimmed } as never);
      if (rejected.includes("ownerChannelUsername")) {
        hapticNotify("error");
        flash(t("miniapp.ownerChannelNotAdmin"));
      } else {
        flash(t("miniapp.savedToast"));
      }
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    } finally {
      setSavingOwnerChannel(false);
    }
  }

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

  const minAccountAgeOptions = MIN_ACCOUNT_AGE_PRESETS.map((n) => ({
    value: String(n),
    label: n === 0 ? t("common.off") : String(n),
  }));

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />
      <Card>
        <CardSection>
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
            <div>
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
          <Row label={t("miniapp.blockUnauthorizedBotsTitle")}>
            <Toggle
              checked={settings.blockUnauthorizedBots}
              onChange={(v) => setField("blockUnauthorizedBots", v)}
            />
          </Row>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.blockUnauthorizedBotsHint")}
          </p>

          <Divider />
          <Row label={t("miniapp.captchaTitle")}>
            <Toggle checked={settings.captchaEnabled} onChange={(v) => setField("captchaEnabled", v)} />
          </Row>
          <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.captchaHint")}
          </p>
          {settings.captchaEnabled && (
            <>
              <div className="mb-3">
                <p className="text-[12px] mb-1.5" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.captchaTypeLabel")}
                </p>
                <SegmentedControl
                  value={settings.captchaType}
                  onChange={(v) => setField("captchaType", v)}
                  columns={4}
                  options={[
                    { value: "button", label: t("miniapp.captchaTypeButton") },
                    { value: "math", label: t("miniapp.captchaTypeMath") },
                    { value: "rules", label: t("miniapp.captchaTypeRules") },
                    { value: "message", label: t("miniapp.captchaTypeMessage") },
                  ]}
                />
              </div>
              {settings.captchaType === "message" && (
                <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
                  {t("miniapp.captchaTypeMessageHint")}
                </p>
              )}
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
                    <Button variant="primary" onClick={saveRulesText} disabled={savingRulesText} className="shrink-0">
                      {t("common.save")}
                    </Button>
                  </div>
                </div>
              )}
              <div className="mb-1">
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
          <Row label={t("miniapp.joinRequestCaptchaTitle")}>
            <Toggle
              checked={settings.joinRequestCaptchaEnabled}
              onChange={(v) => setField("joinRequestCaptchaEnabled", v)}
            />
          </Row>
          <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.joinRequestCaptchaHint")}
          </p>

          <Divider />
          <Row label={t("miniapp.antiraidTitle")}>
            {/* Effective state, not just the manual flag — antiraidAuto
                defaults true, so a fresh group is already protected even
                with antiraidEnabled off; showing the raw flag here used to
                contradict both the bot's own /settings output and the
                actual runtime behavior. Toggling off turns off both (see
                applyAntiraidCascade in lib/db/groups.ts) — "off" means off. */}
            <Toggle
              checked={settings.antiraidEnabled || settings.antiraidAuto}
              onChange={(v) => setField("antiraidEnabled", v)}
            />
          </Row>
          <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.antiraidHint")}
          </p>

          <Divider />
          <p className="text-[13px] font-medium mb-1.5">{t("miniapp.premiumJoinFilterTitle")}</p>
          <SegmentedControl
            value={settings.premiumJoinFilter}
            onChange={(v) => setField("premiumJoinFilter", v)}
            columns={3}
            options={[
              { value: "off", label: t("common.off") },
              { value: "block_premium", label: t("miniapp.premiumJoinFilterBlockPremium") },
              { value: "block_non_premium", label: t("miniapp.premiumJoinFilterBlockNonPremium") },
            ]}
          />

          <Divider />
          <SubLabel subtitle={t("miniapp.channelGateHint")}>{t("miniapp.channelGateTitle")}</SubLabel>
          <div className="flex gap-2 mb-3">
            <input
              value={ownerChannelInput}
              onChange={(e) => setOwnerChannelInput(e.target.value)}
              placeholder={t("miniapp.channelGatePlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="primary" onClick={saveOwnerChannel} disabled={savingOwnerChannel} className="shrink-0">
              {t("common.save")}
            </Button>
          </div>
          <Row label={t("miniapp.channelGateEnabledLabel")}>
            <Toggle
              checked={settings.ownerChannelGateEnabled}
              onChange={(v) => setField("ownerChannelGateEnabled", v)}
              disabled={!settings.ownerChannelId}
            />
          </Row>

          <Divider />
          {/* Same mechanism as the channel-gate above (blocks writing until
              subscribed) — kept next to it, not filed under monetization
              where the "you'll block people" consequence wasn't visible. */}
          <Row label={t("miniapp.helpProjectLabel")}>
            <Toggle checked={settings.promoChannelOptIn} onChange={(v) => setField("promoChannelOptIn", v)} />
          </Row>
          <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.helpProjectHint")}
          </p>

          <Divider />
          <Collapsible title={t("miniapp.fineTuneSectionEntry")}>
            <Row label={t("miniapp.blockNoUsernameTitle")}>
              <Toggle checked={settings.blockNoUsername} onChange={(v) => setField("blockNoUsername", v)} />
            </Row>
            <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.blockNoUsernameHint")}
            </p>
            <Divider />
            <Row label={t("miniapp.blockNoPhotoTitle")}>
              <Toggle checked={settings.blockNoPhoto} onChange={(v) => setField("blockNoPhoto", v)} />
            </Row>
            <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.blockNoPhotoHint")}
            </p>
            <Divider />
            <p className="text-[13px] font-medium mb-1.5">{t("miniapp.minAccountAgeTitle")}</p>
            <p className="text-[12px] mb-2" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.minAccountAgeHint")}
            </p>
            <SegmentedControl
              value={String(settings.minAccountAgeDays)}
              onChange={(v) => setField("minAccountAgeDays", Number(v))}
              columns={minAccountAgeOptions.length}
              options={minAccountAgeOptions}
            />
          </Collapsible>
        </CardSection>
      </Card>
    </div>
  );
}

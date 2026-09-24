"use client";

import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Row, Divider, SubLabel } from "@/components/SettingsPrimitives";
import { useSettingsField } from "@/lib/miniapp/useSettingsField";
import { useToast, Toast } from "@/lib/miniapp/useToast";

const WARN_LIMIT_PRESETS = [3, 5, 10];
const VOTE_BAN_THRESHOLD_PRESETS = [3, 5, 10];

/** "Наказания" subscreen (PR-1 split) — what happens to a violator.
 * purgeMessagesOnBan lives here too, not filed separately — it's part of
 * "what happens on a ban". */
export default function PunishmentsSettingsPage() {
  const { t } = useApp();
  const { settings } = useGroup();
  const { toast, flash } = useToast();
  const setField = useSettingsField(flash);

  if (!settings) return null;

  const warnLimitOptions = WARN_LIMIT_PRESETS.includes(settings.warnLimit)
    ? WARN_LIMIT_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...WARN_LIMIT_PRESETS, settings.warnLimit].map((n) => ({ value: String(n), label: String(n) }));

  const voteBanThresholdOptions = VOTE_BAN_THRESHOLD_PRESETS.includes(settings.voteBanThreshold)
    ? VOTE_BAN_THRESHOLD_PRESETS.map((n) => ({ value: String(n), label: String(n) }))
    : [...VOTE_BAN_THRESHOLD_PRESETS, settings.voteBanThreshold].map((n) => ({ value: String(n), label: String(n) }));

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />
      <Card>
        <CardSection>
          <SubLabel>{t("miniapp.violationAction")}</SubLabel>
          <SegmentedControl
            value={settings.action}
            onChange={(action) => setField("action", action)}
            columns={3}
            options={[
              { value: "delete", label: t("miniapp.actionDelete") },
              { value: "warn", label: t("miniapp.actionWarn") },
              { value: "mute", label: t("miniapp.actionMute") },
              { value: "kick", label: t("miniapp.actionKick") },
              { value: "ban", label: t("miniapp.actionBan") },
            ]}
          />

          <Divider />
          <div className="mt-3">
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
                    columns={3}
                    options={[
                      { value: "mute", label: t("miniapp.actionMute") },
                      { value: "kick", label: t("miniapp.actionKick") },
                      { value: "ban", label: t("miniapp.actionBan") },
                    ]}
                  />
                </div>
              </>
            )}
          </div>

          <Divider />
          <div className="mt-3">
            <SubLabel subtitle={t("miniapp.voteBanHint")}>{t("miniapp.voteBanTitle")}</SubLabel>
            <SegmentedControl
              value={String(settings.voteBanThreshold)}
              onChange={(v) => setField("voteBanThreshold", Number(v))}
              columns={voteBanThresholdOptions.length}
              options={voteBanThresholdOptions}
            />
          </div>

          <Divider />
          <div className="mt-3">
            <Row label={t("miniapp.purgeMessagesOnBanTitle")}>
              <Toggle
                checked={settings.purgeMessagesOnBan}
                onChange={(v) => setField("purgeMessagesOnBan", v)}
              />
            </Row>
            <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.purgeMessagesOnBanHint")}
            </p>
          </div>
        </CardSection>
      </Card>
    </div>
  );
}

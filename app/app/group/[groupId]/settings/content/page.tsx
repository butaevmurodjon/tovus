"use client";

import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { Collapsible } from "@/components/Collapsible";
import { Row, Divider } from "@/components/SettingsPrimitives";
import { useSettingsField } from "@/lib/miniapp/useSettingsField";
import { useToast, Toast } from "@/lib/miniapp/useToast";
import { ALL_STRICT_CONTENT_RULES, type StrictContentRule } from "@/lib/moderation/strictContentRules";

const STRICT_CONTENT_RULE_OPTIONS: { value: StrictContentRule; labelKey: string }[] = ALL_STRICT_CONTENT_RULES.map(
  (value) => ({ value, labelKey: `miniapp.strictContentRule_${value}` })
);

/** "Защита" subscreen (PR-1 split of the old single settings page) —
 * content filters + the strict-content chips on view, rarer refinements
 * (reactions/OCR/anti-first-comment) tucked under "Тонкая настройка". */
export default function ContentSettingsPage() {
  const { t } = useApp();
  const { settings, ocrConfigured } = useGroup();
  const { toast, flash } = useToast();
  const setField = useSettingsField(flash);

  if (!settings) return null;

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />
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
          <Row label={t("miniapp.premiumMode")}>
            <Toggle checked={settings.premium} onChange={(v) => setField("premium", v)} />
          </Row>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.premiumHint")}
          </p>

          <Divider />
          <p className="text-[13px] font-medium mt-2 mb-1.5">{t("miniapp.strictContentTitle")}</p>
          <p className="text-[12px] mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.strictContentHint")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STRICT_CONTENT_RULE_OPTIONS.map(({ value, labelKey }) => {
              const active = settings.strictContentRules.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setField(
                      "strictContentRules",
                      active
                        ? settings.strictContentRules.filter((r) => r !== value)
                        : [...settings.strictContentRules, value]
                    )
                  }
                  className="rounded-full px-3 py-1.5 text-[12px] font-medium border"
                  style={
                    active
                      ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" }
                      : { borderColor: "var(--border-strong)", color: "var(--ink)" }
                  }
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>

          <Divider />
          <Collapsible title={t("miniapp.fineTuneSectionContent")}>
            <Row label={t("miniapp.reactionSpamTitle")}>
              <Toggle checked={settings.reactionSpamEnabled} onChange={(v) => setField("reactionSpamEnabled", v)} />
            </Row>
            <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.reactionSpamHint")}
            </p>
            <Divider />
            <Row label={t("miniapp.ocrTitle")}>
              <Toggle
                checked={settings.ocrEnabled}
                onChange={(v) => setField("ocrEnabled", v)}
                disabled={!ocrConfigured}
              />
            </Row>
            <p className="text-[12px] mt-1 mb-3" style={{ color: ocrConfigured ? "var(--ink-muted)" : "#a3401f" }}>
              {ocrConfigured ? t("miniapp.ocrHint") : t("miniapp.ocrNotConfiguredHint")}
            </p>
            <Divider />
            <Row label={t("miniapp.antiFirstCommentTitle")}>
              <Toggle
                checked={settings.antiFirstCommentEnabled}
                onChange={(v) => setField("antiFirstCommentEnabled", v)}
              />
            </Row>
            <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
              {t("miniapp.antiFirstCommentHint")}
            </p>
          </Collapsible>
        </CardSection>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { CardSection, Card } from "@/components/Card";
import { Toggle } from "@/components/Toggle";
import { Button } from "@/components/Button";
import { Row, Divider, SubLabel } from "@/components/SettingsPrimitives";
import { useSettingsField } from "@/lib/miniapp/useSettingsField";
import { useToast, Toast } from "@/lib/miniapp/useToast";
import { hapticNotify } from "@/lib/miniapp/telegram";
import { ApiError } from "@/lib/miniapp/api";

/** "Чат и уведомления" subscreen (PR-1 split) — what shows inside the chat
 * itself (quiet hours, service messages, welcome text) plus what the admin
 * sees outside it (log channel, monthly digest). Used to be 4 separate
 * cards. */
export default function NotificationsSettingsPage() {
  const { t } = useApp();
  const { settings, updateSettings } = useGroup();
  const { toast, flash } = useToast();
  const setField = useSettingsField(flash);

  const [welcomeInput, setWelcomeInput] = useState(settings?.welcomeMessage ?? "");
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [logChannelInput, setLogChannelInput] = useState(settings?.logChannelId?.toString() ?? "");
  const [savingLogChannel, setSavingLogChannel] = useState(false);
  const [nightStartInput, setNightStartInput] = useState(String(settings?.nightModeStartHour ?? 23));
  const [nightEndInput, setNightEndInput] = useState(String(settings?.nightModeEndHour ?? 7));
  const [savingNightHours, setSavingNightHours] = useState(false);

  if (!settings) return null;

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

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <Toast message={toast} />
      <Card>
        <CardSection>
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
          <Row label={t("miniapp.deleteNoticeTitle")}>
            <Toggle checked={settings.deleteNotice} onChange={(v) => setField("deleteNotice", v)} />
          </Row>
          <p className="text-[12px] mt-2 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.deleteNoticeHint")}
          </p>

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
                    className="w-full min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
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
                    className="w-full min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
                    style={{ borderColor: "var(--border-strong)" }}
                  />
                </div>
                <Button variant="primary" onClick={saveNightHours} disabled={savingNightHours} className="shrink-0">
                  {t("common.save")}
                </Button>
              </div>
              <p className="text-[12px] mt-1.5" style={{ color: "var(--ink-muted)" }}>
                {t("miniapp.nightModeUtcHint")}
              </p>
            </div>
          )}

          <Divider />
          <Row label={t("miniapp.adminTaggerTitle")}>
            <Toggle checked={settings.adminTaggerEnabled} onChange={(v) => setField("adminTaggerEnabled", v)} />
          </Row>
          <p className="text-[12px] mt-1 mb-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.adminTaggerHint")}
          </p>

          <Divider />
          <SubLabel subtitle={t("miniapp.welcomeHint")}>{t("miniapp.welcomeTitle")}</SubLabel>
          <div className="flex gap-2 mb-2">
            <input
              value={welcomeInput}
              onChange={(e) => setWelcomeInput(e.target.value)}
              placeholder={t("miniapp.welcomePlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="primary" onClick={saveWelcome} disabled={savingWelcome} className="shrink-0">
              {t("common.save")}
            </Button>
          </div>

          <Divider />
          <SubLabel subtitle={t("miniapp.logChannelHint")}>{t("miniapp.logChannelTitle")}</SubLabel>
          <div className="flex gap-2 mb-2">
            <input
              value={logChannelInput}
              onChange={(e) => setLogChannelInput(e.target.value)}
              placeholder={t("miniapp.logChannelPlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="primary" onClick={saveLogChannel} disabled={savingLogChannel} className="shrink-0">
              {t("common.save")}
            </Button>
          </div>

          <Divider />
          <Row label={t("miniapp.monthlyDigestTitle")}>
            <Toggle
              checked={settings.monthlyDigestEnabled}
              onChange={(v) => setField("monthlyDigestEnabled", v)}
            />
          </Row>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.monthlyDigestHint")}
          </p>
        </CardSection>
      </Card>
    </div>
  );
}

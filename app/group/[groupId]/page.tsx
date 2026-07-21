"use client";

import { useEffect, useState } from "react";
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
import { isProActive, FREE_TIER_MAX_MEMBERS } from "@/lib/billing/plan";
import { PRESET_KEYS, type PresetKey } from "@/lib/moderation/presets";
import type { ViolationAction } from "@/lib/db/types";

const PRESET_LABEL_KEY: Record<PresetKey, string> = {
  agro: "miniapp.presetAgro",
  ecommerce: "miniapp.presetEcommerce",
  edtech: "miniapp.presetEdtech",
};

export default function GroupSettingsPage() {
  const { t, fetcher, lang } = useApp();
  const { settings, whitelist, missingPermissions, proFeaturesEligible, updateSettings, chatId, refresh } =
    useGroup();
  const [toast, setToast] = useState<string | null>(null);
  const [logChannelInput, setLogChannelInput] = useState(settings?.logChannelId?.toString() ?? "");
  const [whitelistInput, setWhitelistInput] = useState("");
  const [customWords, setCustomWords] = useState<string[] | null>(null);
  const [customWordInput, setCustomWordInput] = useState("");
  const [welcomeInput, setWelcomeInput] = useState(settings?.welcomeMessage ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`)
      .then((data) => !cancelled && setCustomWords(data.words))
      .catch(() => !cancelled && setCustomWords([]));
    return () => {
      cancelled = true;
    };
  }, [chatId, fetcher]);

  if (!settings) return null;

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 1600);
  }

  async function toggle(key: "profanityFilter" | "antispam" | "premium", value: boolean) {
    haptic("light");
    setBusy(true);
    try {
      await updateSettings({ [key]: value } as never);
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function setAction(action: ViolationAction) {
    haptic("light");
    setBusy(true);
    try {
      await updateSettings({ action });
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function saveLogChannel() {
    setBusy(true);
    try {
      const trimmed = logChannelInput.trim();
      const logChannelId = trimmed === "" ? null : Number(trimmed);
      if (logChannelId !== null && !Number.isFinite(logChannelId)) return;
      await updateSettings({ logChannelId });
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function saveWelcome() {
    setBusy(true);
    try {
      const trimmed = welcomeInput.trim();
      await updateSettings({
        welcomeMessage: trimmed === "" ? null : trimmed,
        welcomeEnabled: trimmed !== "",
      });
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleProFeature(key: "captchaEnabled" | "antiraidEnabled", value: boolean) {
    haptic("light");
    setBusy(true);
    try {
      await updateSettings({ [key]: value } as never);
      flash(t("miniapp.savedToast"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        hapticNotify("error");
        flash(t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS }));
      } else {
        hapticNotify("error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleUpgrade() {
    haptic("light");
    setBusy(true);
    try {
      const { link } = await fetcher<{ link: string }>(`/api/miniapp/groups/${chatId}/upgrade`, { method: "POST" });
      openInvoice(link, (status) => {
        if (status === "paid") {
          hapticNotify("success");
          setTimeout(refresh, 1500);
        }
      });
    } finally {
      setBusy(false);
    }
  }

  async function applyPreset(preset: PresetKey) {
    haptic("light");
    setBusy(true);
    try {
      const data = await fetcher<{ added: number; words: string[] }>(`/api/miniapp/groups/${chatId}/presets`, {
        method: "POST",
        body: JSON.stringify({ preset }),
      });
      setCustomWords(data.words);
      flash(t("miniapp.presetApplied", { preset, count: data.added }));
    } finally {
      setBusy(false);
    }
  }

  async function addWhitelistUser() {
    const id = Number(whitelistInput.trim());
    if (!Number.isFinite(id)) return;
    setBusy(true);
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/whitelist`, {
        method: "POST",
        body: JSON.stringify({ userId: id }),
      });
      setWhitelistInput("");
      refresh();
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function removeWhitelistUser(id: number) {
    setBusy(true);
    try {
      await fetcher(`/api/miniapp/groups/${chatId}/whitelist?userId=${id}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addCustomWordEntry() {
    const word = customWordInput.trim();
    if (!word) return;
    setBusy(true);
    try {
      const data = await fetcher<{ words: string[] }>(`/api/miniapp/groups/${chatId}/customwords`, {
        method: "POST",
        body: JSON.stringify({ word }),
      });
      setCustomWords(data.words);
      setCustomWordInput("");
      flash(t("miniapp.savedToast"));
    } finally {
      setBusy(false);
    }
  }

  async function removeCustomWordEntry(word: string) {
    setBusy(true);
    try {
      const data = await fetcher<{ words: string[] }>(
        `/api/miniapp/groups/${chatId}/customwords?word=${encodeURIComponent(word)}`,
        { method: "DELETE" }
      );
      setCustomWords(data.words);
    } finally {
      setBusy(false);
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

      <PermissionWarning missing={missingPermissions} action={settings.action} t={t} />

      <Card>
        <CardSection title={t("miniapp.planTitle")}>
          <div className="flex items-center justify-between">
            <Badge variant={isProActive(settings) ? "accent" : "neutral"}>
              {isProActive(settings)
                ? `${t("miniapp.planProBadge")} · ${t("miniapp.planExpiresOn", {
                    date: settings.planExpiresAt
                      ? new Date(settings.planExpiresAt).toLocaleDateString(lang === "uz" ? "uz-UZ" : "ru-RU")
                      : "—",
                  })}`
                : t("miniapp.planFreeBadge")}
            </Badge>
            {!isProActive(settings) && (
              <Button variant="primary" onClick={handleUpgrade} disabled={busy}>
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
            <Toggle checked={settings.profanityFilter} onChange={(v) => toggle("profanityFilter", v)} disabled={busy} />
          </Row>
          <Divider />
          <Row label={t("miniapp.antispam")}>
            <Toggle checked={settings.antispam} onChange={(v) => toggle("antispam", v)} disabled={busy} />
          </Row>
          <Divider />
          <Row label={t("miniapp.premiumMode")}>
            <Toggle checked={settings.premium} onChange={(v) => toggle("premium", v)} disabled={busy} />
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
        <CardSection title={t("miniapp.whitelistTitle")} subtitle={t("miniapp.whitelistHint")}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {whitelist.length === 0 && (
              <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                —
              </span>
            )}
            {whitelist.map((id) => (
              <Badge key={id} variant="neutral">
                <span className="flex items-center gap-1.5">
                  id{id}
                  <button
                    onClick={() => removeWhitelistUser(id)}
                    aria-label={t("common.remove")}
                    className="font-bold"
                  >
                    ×
                  </button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
              placeholder={t("miniapp.whitelistAddPlaceholder")}
              inputMode="numeric"
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="secondary" onClick={addWhitelistUser} disabled={busy}>
              {t("common.add")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.customWordsTitle")} subtitle={t("miniapp.customWordsHint")}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {customWords !== null && customWords.length === 0 && (
              <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                —
              </span>
            )}
            {(customWords ?? []).map((word) => (
              <Badge key={word} variant="neutral">
                <span className="flex items-center gap-1.5">
                  {word}
                  <button
                    onClick={() => removeCustomWordEntry(word)}
                    aria-label={t("common.remove")}
                    className="font-bold"
                  >
                    ×
                  </button>
                </span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={customWordInput}
              onChange={(e) => setCustomWordInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomWordEntry()}
              placeholder={t("miniapp.customWordsAddPlaceholder")}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] px-3 py-2 text-[13px] border"
              style={{ borderColor: "var(--border-strong)" }}
            />
            <Button variant="secondary" onClick={addCustomWordEntry} disabled={busy}>
              {t("common.add")}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t("miniapp.presetsTitle")} subtitle={t("miniapp.presetsHint")}>
          <div className="flex flex-wrap gap-2">
            {PRESET_KEYS.map((key) => (
              <Button key={key} variant="secondary" onClick={() => applyPreset(key)} disabled={busy}>
                {t(PRESET_LABEL_KEY[key])}
              </Button>
            ))}
          </div>
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
            <Button variant="primary" onClick={saveLogChannel} disabled={busy}>
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
            <Button variant="primary" onClick={saveWelcome} disabled={busy}>
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
              <Toggle
                checked={settings.captchaEnabled}
                onChange={(v) => toggleProFeature("captchaEnabled", v)}
                disabled={busy}
              />
            </Row>
            <p className="text-[12px] mt-1 mb-3" style={{ color: "var(--ink-muted)" }}>
              {proFeaturesEligible ? t("miniapp.captchaHint") : t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS })}
            </p>
            <Divider />
            <Row
              label={
                <span className="flex items-center gap-1.5">
                  {t("miniapp.antiraidTitle")}
                  {!proFeaturesEligible && <Badge variant="warning">PRO</Badge>}
                </span>
              }
            >
              <Toggle
                checked={settings.antiraidEnabled}
                onChange={(v) => toggleProFeature("antiraidEnabled", v)}
                disabled={busy}
              />
            </Row>
            <p className="text-[12px] mt-1" style={{ color: "var(--ink-muted)" }}>
              {proFeaturesEligible ? t("miniapp.antiraidHint") : t("miniapp.proLockedHint", { limit: FREE_TIER_MAX_MEMBERS })}
            </p>
          </Collapsible>
        </CardSection>
      </Card>
    </div>
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

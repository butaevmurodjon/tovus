"use client";

import { useApp } from "@/contexts/AppProvider";
import { useGroup } from "@/contexts/GroupProvider";
import { haptic, hapticNotify } from "./telegram";
import type { GroupSettings } from "@/lib/db/types";

/**
 * `setField(key, value)` for a single-field group-settings PATCH: applies
 * immediately in the UI (GroupProvider.updateSettings is itself optimistic),
 * haptic on tap, error toast + haptic if the background request fails.
 * Shared by every settings subscreen (PR-1 split) — was a local function
 * duplicated per screen before.
 */
export function useSettingsField(flash: (message: string) => void) {
  const { t } = useApp();
  const { updateSettings } = useGroup();

  async function setField<K extends keyof GroupSettings>(key: K, value: GroupSettings[K]) {
    haptic("light");
    try {
      await updateSettings({ [key]: value } as never);
    } catch {
      hapticNotify("error");
      flash(t("miniapp.errorToast"));
    }
  }

  return setField;
}

import type { GroupSettings } from "@/lib/db/types";

/** A zero-length window (start === end) reads as "disabled", not "always on" —
 * an admin who set both hours the same never meant to mute the group forever. */
export function isWithinNightModeWindow(nowHourUtc: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  if (startHour < endHour) return nowHourUtc >= startHour && nowHourUtc < endHour;
  return nowHourUtc >= startHour || nowHourUtc < endHour;
}

export function isNightModeActive(
  settings: Pick<GroupSettings, "nightModeEnabled" | "nightModeStartHour" | "nightModeEndHour">
): boolean {
  if (!settings.nightModeEnabled) return false;
  return isWithinNightModeWindow(new Date().getUTCHours(), settings.nightModeStartHour, settings.nightModeEndHour);
}

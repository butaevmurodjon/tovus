import type { ViolationAction } from "@/lib/db/types";

export function PermissionWarning({
  missing,
  action,
  t,
}: {
  missing: string[];
  action: ViolationAction;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (missing.length === 0) return null;

  return (
    <div
      className="rounded-[var(--radius-md)] border p-3.5"
      style={{ borderColor: "var(--status-critical)", background: "var(--status-critical-wash)" }}
    >
      <p className="text-[13px] font-semibold mb-1.5" style={{ color: "#a12a2a" }}>
        {t("bot.permWarningHeader")}
      </p>
      <ul className="text-[12px] flex flex-col gap-0.5" style={{ color: "#a12a2a" }}>
        {missing.includes("admin") && <li>• {t("bot.permMissingAdmin")}</li>}
        {missing.includes("delete") && <li>• {t("bot.permMissingDelete")}</li>}
        {missing.includes("restrict") && (
          <li>• {t("bot.permMissingRestrict", { action: t(`bot.actionNames.${action}`) })}</li>
        )}
      </ul>
    </div>
  );
}

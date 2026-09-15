import Link from "next/link";
import { Card } from "./Card";

/**
 * One row on the settings index pointing at a subscreen (PR-1 split).
 * `status` must be a live VALUE, not a description of what the subscreen
 * contains — Material's settings guidance is explicit that the label should
 * show current state ("Мат, спам, CAS" / "Выключено"), not a caption
 * ("Фильтры контента"). Mirrors GroupCard's link-card shape so the index
 * reads as "one more list", not a new pattern.
 */
export function SettingsLink({
  href,
  icon,
  title,
  status,
}: {
  href: string;
  icon: string;
  title: string;
  status: string;
}) {
  return (
    <Link href={href} className="block active:opacity-70 transition-opacity">
      <Card className="p-3.5 flex items-center gap-3">
        <span className="text-[18px] leading-none shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>
            {title}
          </p>
          <p className="text-[12px] mt-0.5 truncate" style={{ color: "var(--ink-muted)" }}>
            {status}
          </p>
        </div>
        <span style={{ color: "var(--ink-muted)" }}>›</span>
      </Card>
    </Link>
  );
}

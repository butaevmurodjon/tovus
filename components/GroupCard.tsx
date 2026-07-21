import Link from "next/link";
import { Card } from "./Card";
import { Badge } from "./Badge";
import type { AdminGroupSummary } from "@/lib/db/types";

export function GroupCard({
  group,
  labels,
}: {
  group: AdminGroupSummary;
  labels: { premium: string; basic: string; permissionIssue: string };
}) {
  return (
    <Link href={`/group/${group.chatId}`} className="block">
      <Card className="p-4 flex items-center justify-between gap-3 active:opacity-70 transition-opacity">
        <div className="min-w-0">
          <p className="text-[14px] font-medium truncate" style={{ color: "var(--ink)" }}>
            {group.title || `Chat ${group.chatId}`}
          </p>
          <div className="flex gap-1.5 mt-1.5">
            <Badge variant={group.premium ? "accent" : "neutral"}>
              {group.premium ? labels.premium : labels.basic}
            </Badge>
            {group.hasPermissionIssue && <Badge variant="critical">{labels.permissionIssue}</Badge>}
          </div>
        </div>
        <span style={{ color: "var(--ink-muted)" }}>›</span>
      </Card>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";

interface Group {
  chatId: number;
  title: string;
  premium?: boolean;
}

export default function OwnerPage() {
  const { fetcher, status, isOwner } = useApp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function init() {
      if (status !== "ready") return;
      try {
        const groupsData = await fetcher<{ groups: Group[] }>("/api/miniapp/groups");
        if (!active) return;
        if (!isOwner) {
          setLoading(false);
          return;
        }
        setGroups(groupsData.groups ?? []);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load owner data:", err);
        if (active) {
          setLoading(false);
        }
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [fetcher, isOwner, status]);

  if (status === "loading") return <p className="text-muted">Загрузка...</p>;
  if (!isOwner) return <p>Доступ запрещён</p>;

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-2">Группы бота</h1>
      <p className="text-sm mb-4 text-muted">Откройте группу, затем вкладку «Управление» для ручных действий.</p>
      {loading ? (
        <p className="text-muted">Загрузка...</p>
      ) : groups.length === 0 ? (
        <p>Нет доступных групп</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.chatId} className="border rounded p-3">
              <div className="font-medium">{g.title}</div>
              <div className="text-xs text-muted">ID: {g.chatId}</div>
              <Link href={`/group/${g.chatId}/owner`} className="inline-block mt-2 text-sm font-medium" style={{ color: "var(--accent)" }}>
                Открыть управление
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

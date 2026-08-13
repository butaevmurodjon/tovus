"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";

interface Group {
  chatId: number;
  title: string;
  premium?: boolean;
}

export default function OwnerPage() {
  const { fetcher, status } = useApp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [banInput, setBanInput] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [checkedOwner, setCheckedOwner] = useState(false);

  useEffect(() => {
    let active = true;
    async function init() {
      if (status !== "ready") return;
      try {
        const [me, groupsData] = await Promise.all([
          fetcher<{ isOwner: boolean }>("/api/miniapp/me"),
          fetcher<{ groups: Group[] }>("/api/miniapp/groups"),
        ]);
        if (!active) return;
        setIsOwner(!!me.isOwner);
        setCheckedOwner(true);
        if (!me.isOwner) {
          setLoading(false);
          return;
        }
        setGroups(groupsData.groups ?? []);
        setLoading(false);
      } catch (err) {
        console.error("Failed to load owner data:", err);
        if (active) {
          setLoading(false);
          setCheckedOwner(true);
        }
      }
    }
    init();
    return () => {
      active = false;
    };
  }, [fetcher, status]);

  async function banUser(chatId: number) {
    const raw = (banInput[chatId] ?? "").trim();
    const userId = Number(raw);
    if (!userId) return;
    setBusy(chatId);
    try {
      await fetcher(`/api/miniapp/owner/groups/${chatId}/ban`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      alert("Бан выполнен");
    } catch (err) {
      console.error("Failed to ban user:", err);
      alert("Не удалось забанить");
    } finally {
      setBusy(null);
    }
  }

  if (status === "loading" || !checkedOwner) return <p className="text-muted">Загрузка...</p>;
  if (!isOwner) return <p>Доступ запрещён</p>;

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Панель владельца</h1>
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
              <div className="flex gap-2 mt-2">
                <input
                  type="number"
                  placeholder="User ID"
                  value={banInput[g.chatId] ?? ""}
                  onChange={(e) =>
                    setBanInput((prev) => ({ ...prev, [g.chatId]: e.target.value }))
                  }
                  className="border px-2 py-1 rounded w-32"
                />
                <button
                  onClick={() => banUser(g.chatId)}
                  disabled={busy === g.chatId}
                  className="px-3 py-1 bg-red-500 text-white rounded"
                >
                  Ban
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

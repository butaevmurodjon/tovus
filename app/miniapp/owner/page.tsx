"use client";

import { useEffect, useState } from "react";

interface Group {
  chatId: number;
  title: string;
  premium?: boolean;
}

export default function OwnerPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [banInput, setBanInput] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [checkedOwner, setCheckedOwner] = useState(false);

  useEffect(() => {
    let active = true;
    async function init() {
      try {
        const [meRes, groupsRes] = await Promise.all([
          fetch("/api/miniapp/me"),
          fetch("/api/miniapp/groups"),
        ]);
        const me = await meRes.json();
        if (!active) return;
        setIsOwner(!!me.isOwner);
        setCheckedOwner(true);
        if (!me.isOwner) {
          setLoading(false);
          return;
        }
        const data = await groupsRes.json();
        if (!active) return;
        setGroups(data.groups ?? []);
        setLoading(false);
      } catch {
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
  }, []);

  async function banUser(chatId: number) {
    const raw = (banInput[chatId] ?? "").trim();
    const userId = Number(raw);
    if (!userId) return;
    setBusy(chatId);
    try {
      const res = await fetch(`/api/miniapp/owner/groups/${chatId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) alert("Бан выполнен");
      else alert("Не удалось забанить");
    } finally {
      setBusy(null);
    }
  }

  if (!checkedOwner) return <p className="text-muted">Загрузка...</p>;
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

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

  useEffect(() => {
    fetch("/api/miniapp/groups")
      .then((r) => r.json())
      .then((data) => setGroups(data.groups ?? []))
      .catch(console.error);
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
      if (res.ok) alert("Banned");
      else alert("Ban failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Owner Panel</h1>
      {groups.length === 0 ? (
        <p>No groups available</p>
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

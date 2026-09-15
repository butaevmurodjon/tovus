"use client";

import { useState } from "react";

/**
 * The same "fixed pill under the header, self-clears" toast that used to be
 * copied verbatim into every page that needs one (settings, journal,
 * owner/bans, owner/broadcast, group/owner, owner/tools — six copies before
 * this). One hook + one render component instead, pulled out during the
 * settings-page subscreen split (PR-1) since that split was about to turn
 * six copies into eleven.
 */
export function useToast(durationMs = 1600) {
  const [toast, setToast] = useState<string | null>(null);
  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), durationMs);
  }
  return { toast, flash };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-2rem)] rounded-full px-3.5 py-1.5 text-center text-[12px] font-medium"
      style={{ background: "var(--ink)", color: "#fff" }}
    >
      {message}
    </div>
  );
}

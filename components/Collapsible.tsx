"use client";

import { useState } from "react";

export function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-1"
        aria-expanded={open}
      >
        <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
          {title}
        </span>
        <span
          className="text-[12px] transition-transform"
          style={{ color: "var(--ink-muted)", transform: open ? "rotate(180deg)" : "none" }}
        >
          ▾
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

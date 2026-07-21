"use client";

import { AppProvider } from "@/contexts/AppProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

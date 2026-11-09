"use client";

import { Minimize2, Maximize2 } from "lucide-react";

/** Expand/collapse button shown in every panel header. */
export default function FsButton({
  fs,
  onToggle,
  label,
}: {
  fs: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onToggle}
      aria-label={fs ? `Close ${label} fullscreen` : `Open ${label} fullscreen`}
      aria-pressed={fs}
      title={fs ? "بازگشت (Esc)" : "تمام‌صفحه"}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {fs ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}
    </button>
  );
}

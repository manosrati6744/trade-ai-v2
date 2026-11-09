"use client";

/**
 * usePanelFs — shared fullscreen state for dashboard panels.
 *
 * Gives every card a "zoom to full page" toggle: the panel becomes a fixed
 * overlay covering the whole viewport, body scroll locks, and Escape closes.
 */

import { useCallback, useEffect, useState } from "react";

export function usePanelFs(): { fs: boolean; toggle: () => void; close: () => void } {
  const [fs, setFs] = useState(false);

  const close = useCallback(() => setFs(false), []);
  const toggle = useCallback(() => setFs((v) => !v), []);

  useEffect(() => {
    if (!fs) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFs(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fs]);

  return { fs, toggle, close };
}

/** Classes that turn a normal panel section into a full-page overlay. */
export const PANEL_FS_CLS =
  "fixed inset-0 z-[80] overflow-y-auto overscroll-contain rounded-none bg-background";

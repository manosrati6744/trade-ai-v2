"use client";

/**
 * CollapsibleCard — the shared accordion shell for every dashboard card.
 *
 * Header = one click target (title + chevron) that expands/collapses the body;
 * interactive extras (refresh, FsButton, badges) live in `trailing`, outside
 * the toggle button. Open/closed state persists per card id in localStorage
 * so the user's layout survives refreshes. `fs` (fullscreen mode) forces the
 * body open and swaps the card classes for the full-page overlay.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { PANEL_FS_CLS } from "@/hooks/use-panel-fs";

const STORE_KEY = "smc-collapsed-v1";
const SYNC_EVENT = "smc-cards-sync";

/** Every collapsible card id on the page — used by the bulk open/close buttons. */
export const SMC_CARD_IDS = [
  "summary",
  "aisniper",
  "aimessages",
  "performance",
  "telegram",
  "signal",
  "priceaction",
  "chart",
  "pressure",
  "dom",
  "tradeplan",
  "zones",
] as const;

function readStore(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === "object" ? (j as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, boolean>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode — collapse state just won't persist */
  }
}

/** Open or close every card at once and notify the mounted ones. */
export function setAllCardsOpen(open: boolean) {
  const store = readStore();
  for (const id of SMC_CARD_IDS) store[id] = open;
  writeStore(store);
  window.dispatchEvent(new CustomEvent(SYNC_EVENT));
}

export default function CollapsibleCard({
  id,
  title,
  subtitle,
  trailing,
  defaultOpen = true,
  fs = false,
  pad = 3,
  accentCls = "border-border",
  bodyCls,
  children,
}: {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  defaultOpen?: boolean;
  fs?: boolean;
  pad?: 3 | 4;
  accentCls?: string;
  bodyCls?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean | null>(null);

  // hydrate from localStorage after mount (avoids SSR mismatch), and follow
  // bulk open/close requests from setAllCardsOpen()
  useEffect(() => {
    const sync = () => {
      const store = readStore();
      setOpen(id in store ? Boolean(store[id]) : defaultOpen);
    };
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    return () => window.removeEventListener(SYNC_EVENT, sync);
  }, [id, defaultOpen]);

  const isOpen = fs || (open ?? defaultOpen);

  const toggle = () => {
    const next = !isOpen;
    setOpen(next);
    const store = readStore();
    store[id] = next;
    writeStore(store);
  };

  const headerPad = pad === 4 ? "px-4 pb-2 pt-3.5" : "px-3 pb-1.5 pt-2.5";
  const bodyPad = bodyCls ?? (pad === 4 ? "px-4 pb-4" : "px-3 pb-3");

  return (
    <section
      className={fs ? PANEL_FS_CLS : `rounded-xl border bg-card ${accentCls}`}
      data-collapsible={id}
    >
      <div className={`flex items-center justify-between gap-2 ${headerPad}`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={`${id}-body`}
          className="group flex min-w-0 flex-1 items-center gap-1.5 text-right"
          title={isOpen ? "بستن این کادر" : "بازکردن این کادر"}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground ${
              isOpen ? "" : "rotate-90"
            }`}
            aria-hidden
          />
          <span className="flex min-w-0 items-center gap-1.5">
            {title}
            {subtitle}
          </span>
        </button>
        {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
      </div>
      <div
        id={`${id}-body`}
        aria-hidden={!isOpen}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        {/* min-h-0 is required: grid items default to min-height:auto and
            would refuse to collapse below their content size */}
        <div className="min-h-0 overflow-hidden">
          <div className={bodyPad}>{children}</div>
        </div>
      </div>
    </section>
  );
}

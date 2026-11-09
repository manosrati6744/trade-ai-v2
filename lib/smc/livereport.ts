"use client";

/**
 * Live market report feed — the moment-to-moment Persian log of what the
 * market is doing: BOS/CHoCH shifts, breakouts & fake-breakouts, order-block
 * taps, pressure thresholds, per-timeframe position flips, unified-theory
 * flips and every new SNIPER AI verdict with its reasons.
 *
 * Client-only: a localStorage ring buffer per symbol + a CustomEvent so
 * every mounted AiMessages panel re-renders the moment page.tsx pushes.
 * Items are deduped by id (stable per event) so a 30s poll never duplicates.
 */

import { useEffect, useState } from "react";

export type LiveKind =
  | "status" // periodic full market-status report
  | "structure" // BOS / CHoCH
  | "zone" // price tapped an order block
  | "breakout"
  | "fakeout"
  | "pressure" // confluence threshold crossing
  | "tfpos" // per-timeframe position flip
  | "consensus" // unified theory flip
  | "ai"; // new SNIPER AI verdict

export interface LiveItem {
  id: string;
  t: number; // epoch ms
  kind: LiveKind;
  tf?: string;
  text: string; // main Persian line
  sub?: string; // secondary line (reasons, levels…)
}

const CAP = 60;
const EVENT = "smc-live";
const key = (sym: string) => `smc-live-${sym}`;

function read(sym: string): LiveItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key(sym));
    const list = raw ? (JSON.parse(raw) as LiveItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(sym: string, items: LiveItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(sym), JSON.stringify(items.slice(0, CAP)));
  } catch {
    /* storage full/unavailable — feed stays in-memory this session */
  }
}

/** push one item; silently ignored when the id already exists */
export function pushLive(sym: string, item: LiveItem): void {
  if (typeof window === "undefined") return;
  const list = read(sym);
  if (list.some((x) => x.id === item.id)) return;
  write(sym, [item, ...list]);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { symbol: sym } }));
}

export function clearLive(sym: string): void {
  write(sym, []);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { symbol: sym } }));
  }
}

/** react hook — the live feed of one symbol, newest first */
export function useLiveFeed(sym: string): LiveItem[] {
  const [items, setItems] = useState<LiveItem[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (alive) setItems(read(sym));
    };
    refresh();
    const h = (e: Event) => {
      const detail = (e as CustomEvent<{ symbol?: string }>).detail;
      if (!detail || detail.symbol === sym) refresh();
    };
    window.addEventListener(EVENT, h);
    window.addEventListener("storage", h);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, h);
      window.removeEventListener("storage", h);
    };
  }, [sym]);

  return items;
}

export const LIVE_KIND_FA: Record<LiveKind, string> = {
  status: "وضعیت بازار",
  structure: "ساختار",
  zone: "زون",
  breakout: "شکست",
  fakeout: "فیک‌شکست",
  pressure: "فشار",
  tfpos: "پوزیشن TF",
  consensus: "نظریهٔ واحد",
  ai: "AI",
};

export const LIVE_KIND_CLS: Record<LiveKind, string> = {
  status: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40",
  structure: "bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/40",
  zone: "bg-teal-500/15 text-teal-300 ring-1 ring-teal-500/40",
  breakout: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40",
  fakeout: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40",
  pressure: "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/40",
  tfpos: "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/40",
  consensus: "bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-fuchsia-500/40",
  ai: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/50",
};

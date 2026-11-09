"use client";

/**
 * useDom — polls /api/dom for the estimated Depth-of-Market ladder and
 * shares one copy of the data with every consumer (summary board weight
 * table, TV chart HUD). 30s cadence matches the main snapshot refresh.
 */

import { useEffect, useState } from "react";

export interface DomData {
  symbol: string;
  digits: number;
  price: number;
  timeframe: string;
  source: string;
  t: number;
  tick: number;
  levels: { p: number; buy: number; sell: number }[];
  imbalance: number;
  buyTotal: number;
  sellTotal: number;
  maxVol: number;
  walls: { bid: { p: number; v: number }; ask: { p: number; v: number } };
  spread: number;
}

export default function useDom(symbolId: string): DomData | null {
  // tagged with the symbol it was fetched for, so a symbol switch never
  // shows the previous market's book (no sync setState in the effect body)
  const [state, setState] = useState<{ sym: string; dom: DomData } | null>(null);

  useEffect(() => {
    let live = true;
    const fetchDom = async () => {
      try {
        const res = await fetch(`/api/dom?symbol=${symbolId}`, { cache: "no-store" });
        const j = await res.json();
        if (live && !j.error) setState({ sym: symbolId, dom: j as DomData });
      } catch {
        /* next poll retries */
      }
    };
    void fetchDom();
    const id = setInterval(fetchDom, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [symbolId]);

  return state && state.sym === symbolId ? state.dom : null;
}

/**
 * useDomAll — per-timeframe deep-market books (5m/15m/30m/1h/4h) in ONE
 * request (`/api/dom?tf=all`), for the summary board's deep-market weight
 * table. Same 30s cadence and symbol-tag guard as useDom.
 */
export function useDomAll(symbolId: string): Record<string, DomData> | null {
  const [state, setState] = useState<{ sym: string; books: Record<string, DomData> } | null>(null);

  useEffect(() => {
    let live = true;
    const fetchAll = async () => {
      try {
        const res = await fetch(`/api/dom?symbol=${symbolId}&tf=all`, { cache: "no-store" });
        const j = await res.json();
        if (live && !j.error && j.books) setState({ sym: symbolId, books: j.books });
      } catch {
        /* next poll retries */
      }
    };
    void fetchAll();
    const id = setInterval(fetchAll, 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [symbolId]);

  return state && state.sym === symbolId ? state.books : null;
}

import type { Candle, TFAnalysis } from "@/lib/smc/engine";

export interface TFSnapshot {
  candles: Candle[];
  analysis: TFAnalysis;
}

export interface SnapshotData {
  symbol: string;
  name: string;
  digits: number;
  yahoo: string;
  tv: string;
  source: "tradingview" | "yahoo";
  sourceNote?: string;
  price: number;
  changePct: number;
  marketTime: number;
  fetchedAt: number;
  tfs: Record<string, TFSnapshot>;
}

export function fmtPrice(v: number | null | undefined, digits: number): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v: number, signed = true): string {
  if (!isFinite(v)) return "—";
  const s = v > 0 && signed ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}

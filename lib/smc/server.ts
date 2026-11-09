/**
 * Shared server-side snapshot loader (TradingView live feed, Yahoo fallback).
 * Used by /api/analysis and /api/ai.
 */

import { analyze, type Candle, type TFAnalysis } from "@/lib/smc/engine";
import type { SymbolConfig } from "@/lib/smc/symbols";
import type { SnapshotData, TFSnapshot } from "@/lib/smc/snapshot";
import { fetchTradingViewCandles } from "@/lib/tv/client";

export const TFS = [
  { id: "5m", interval: "5m", range: "5d", keep: 160, tvRes: "5", tvBars: 300 },
  { id: "15m", interval: "15m", range: "10d", keep: 140, tvRes: "15", tvBars: 300 },
  { id: "30m", interval: "30m", range: "20d", keep: 130, tvRes: "30", tvBars: 300 },
  { id: "1h", interval: "60m", range: "30d", keep: 130, tvRes: "60", tvBars: 300 },
  // Yahoo has no native 4h bars — 1h candles are fetched and aggregated ×4
  { id: "4h", interval: "60m", range: "60d", keep: 120, tvRes: "240", tvBars: 300, aggregate: 4 },
  { id: "1d", interval: "1d", range: "6mo", keep: 120, tvRes: "1D", tvBars: 160 },
];

/** Aggregate hourly (or smaller) candles into N-hour buckets (Yahoo has no 4h). */
function aggregateCandles(candles: Candle[], nHours: number): Candle[] {
  if (nHours <= 1) return candles;
  const bucketSec = nHours * 3600;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const bt = Math.floor(c.t / bucketSec) * bucketSec;
    if (!cur || cur.t !== bt) {
      if (cur) out.push(cur);
      cur = { t: bt, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const CACHE_TTL = 40_000;
const cache = new Map<string, { ts: number; data: SnapshotData }>();

async function fetchChart(
  yahoo: string,
  interval: string,
  range: string
): Promise<{ candles: Candle[]; meta: Record<string, unknown> }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahoo
  )}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error("Yahoo: empty result");
  const ts: number[] = r.timestamp;
  const q = r.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    candles.push({ t: ts[i], o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return { candles, meta: r.meta ?? {} };
}

interface TfData {
  id: string;
  candles: Candle[];
  prevDailyClose?: number;
  marketTime?: number;
}

/** Try the live TradingView WebSocket feed first. */
async function fetchTradingViewAll(cfg: SymbolConfig): Promise<TfData[] | null> {
  try {
    // 6 resolutions + daily handled as a full timeframe now
    const res = await fetchTradingViewCandles(
      cfg.tv,
      TFS.map((tf) => ({ tf: tf.id, res: tf.tvRes, bars: tf.tvBars })),
      14_000
    );
    const out: TfData[] = [];
    for (const tf of TFS) {
      const arr = res.series[tf.id];
      if (!arr || arr.length < 40) return null; // incomplete -> fall back entirely
      out.push({ id: tf.id, candles: arr });
    }
    const daily = res.series["1d"];
    const last5m = out[0].candles;
    out[0].marketTime = last5m[last5m.length - 1].t * 1000;
    if (daily && daily.length >= 2) {
      out[0].prevDailyClose = daily[daily.length - 2].c;
    }
    return out;
  } catch {
    return null;
  }
}

async function fetchYahooAll(cfg: SymbolConfig): Promise<TfData[]> {
  const results = await Promise.allSettled(
    TFS.map((tf) => fetchChart(cfg.yahoo, tf.interval, tf.range))
  );
  const out: TfData[] = [];
  for (let i = 0; i < TFS.length; i++) {
    const r = results[i];
    if (r.status !== "fulfilled" || r.value.candles.length < 40) continue;
    const tf = TFS[i];
    const candles = tf.aggregate
      ? aggregateCandles(r.value.candles, tf.aggregate)
      : r.value.candles;
    if (candles.length < 40) continue;
    out.push({ id: tf.id, candles });
  }
  if (out.length === 0) throw new Error("Yahoo: all timeframes failed");
  return out;
}

export async function getSnapshot(cfg: SymbolConfig): Promise<SnapshotData> {
  const hit = cache.get(cfg.id);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  // 1) Live TradingView feed, 2) Yahoo Finance fallback
  let tfData = await fetchTradingViewAll(cfg);
  let source: "tradingview" | "yahoo" = "tradingview";
  let sourceNote: string | undefined;
  if (!tfData) {
    source = "yahoo";
    sourceNote = "TradingView feed unavailable — using delayed Yahoo Finance data";
    tfData = await fetchYahooAll(cfg);
  }

  const tfs: Record<string, TFSnapshot> = {};
  let price = 0;
  let changePct = 0;
  let marketTime = 0;

  for (let i = 0; i < TFS.length; i++) {
    const tf = TFS[i];
    const d = tfData.find((x) => x.id === tf.id);
    if (!d) continue;
    const full = d.candles;
    if (i === 0) {
      price = full[full.length - 1].c;
      const prev = d.prevDailyClose ?? full[0].c;
      changePct = prev ? ((price - prev) / prev) * 100 : 0;
      marketTime = d.marketTime ?? full[full.length - 1].t * 1000;
    }
    // analysis runs on the full window; the stored candle slice starts
    // (full.length - keep) bars later — the offset keeps overlays aligned
    const analysis: TFAnalysis = analyze(full, tf.id, Math.max(0, full.length - tf.keep));
    tfs[tf.id] = { candles: full.slice(-tf.keep), analysis };
  }

  if (Object.keys(tfs).length === 0) throw new Error("All timeframes failed");

  const data: SnapshotData = {
    symbol: cfg.id,
    name: cfg.name,
    digits: cfg.digits,
    yahoo: cfg.yahoo,
    tv: cfg.tv,
    source,
    sourceNote,
    price,
    changePct,
    marketTime,
    fetchedAt: Date.now(),
    tfs,
  };
  cache.set(cfg.id, { ts: Date.now(), data });
  return data;
}

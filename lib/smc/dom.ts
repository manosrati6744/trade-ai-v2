/**
 * Estimated Depth-of-Market book (LuxAlgo-style), shared by /api/dom and the
 * SNIPER AI payload builder.
 *
 * Real exchange L2 order books are not publicly available for spot gold, oil
 * and forex — even LuxAlgo's popular "Depth of Market" indicator ESTIMATES
 * the book from tick volume. This does the same from the app's own live feed:
 *
 *   1. take the finest timeframe candles from the live snapshot,
 *   2. split every candle's (tick) volume into buy/sell pressure
 *      (close-position-in-range model, recency weighted),
 *   3. distribute that pressure across the price buckets the candle spanned,
 *   4. return a bid/ask ladder centered on the current price + walls +
 *      imbalance + estimated spread.
 */

import { flowSeries, type Candle } from "@/lib/smc/engine";

export interface DomLevel {
  p: number;
  buy: number;
  sell: number;
}

export interface DomBook {
  tick: number;
  levels: DomLevel[];
  imbalance: number;
  buyTotal: number;
  sellTotal: number;
  maxVol: number;
  walls: { bid: { p: number; v: number }; ask: { p: number; v: number } };
  spread: number;
}

const LEVELS_PER_SIDE = 16;
const LOOKBACK = 220;

/** timeframes the deep-market book can be built from ( finest first ) */
export const DOM_TFS = ["5m", "15m", "30m", "1h", "4h"] as const;

export function buildDomBook(candles: Candle[], price: number, digits: number): DomBook {
  // bucket size from recent realized range (~36 buckets over the last 60 bars)
  const recent = candles.slice(-60);
  const hi = Math.max(...recent.map((c) => c.h));
  const lo = Math.min(...recent.map((c) => c.l));
  const rawTick = (hi - lo) / 36;
  const pow = Math.pow(10, digits - 1);
  const tick = Math.max(Math.round(rawTick * pow) / pow, Math.pow(10, -digits));

  const vis = candles.slice(-LOOKBACK);
  const flows = flowSeries(vis, vis.length);

  const buckets = new Map<number, { buy: number; sell: number }>();
  const n = vis.length;

  for (let i = 0; i < n; i++) {
    const c = vis[i];
    const f = flows[i];
    const b0 = Math.floor(c.l / tick);
    const b1 = Math.floor(c.h / tick);
    const span = b1 - b0 + 1;
    if (span <= 0 || n === 0) continue;
    // recency weight 1..1.5 — fresh candles matter more (same idea as engine)
    const w = 1 + (i / Math.max(n - 1, 1)) * 0.5;
    const buyPer = (f.buy * w) / span;
    const sellPer = (f.sell * w) / span;
    for (let b = b0; b <= b1; b++) {
      const e = buckets.get(b) ?? { buy: 0, sell: 0 };
      e.buy += buyPer;
      e.sell += sellPer;
      buckets.set(b, e);
    }
  }

  const midBucket = Math.floor(price / tick);
  const levels: DomLevel[] = [];
  for (let b = midBucket + LEVELS_PER_SIDE; b >= midBucket - LEVELS_PER_SIDE; b--) {
    const e = buckets.get(b) ?? { buy: 0, sell: 0 };
    levels.push({
      p: parseFloat((b * tick).toFixed(digits)),
      buy: Math.round(e.buy),
      sell: Math.round(e.sell),
    });
  }

  const buyTotal = levels.reduce((s, l) => s + l.buy, 0);
  const sellTotal = levels.reduce((s, l) => s + l.sell, 0);
  const imbalance = buyTotal + sellTotal > 0
    ? Math.round(((buyTotal - sellTotal) / (buyTotal + sellTotal)) * 100)
    : 0;

  const maxVol = Math.max(1, ...levels.map((l) => Math.max(l.buy, l.sell)));
  const askWall = levels.reduce((m, l) => (l.sell > m.sell ? l : m), levels[0]);
  const bidWall = levels.reduce((m, l) => (l.buy > m.buy ? l : m), levels[0]);

  // nearest bucket boundary above/below price -> estimated spread
  const bestAsk = (midBucket + 1) * tick;
  const bestBid = midBucket * tick;

  return {
    tick: parseFloat(tick.toFixed(digits)),
    levels,
    imbalance,
    buyTotal: Math.round(buyTotal),
    sellTotal: Math.round(sellTotal),
    maxVol,
    walls: {
      bid: { p: bidWall.p, v: bidWall.buy },
      ask: { p: askWall.p, v: askWall.sell },
    },
    spread: parseFloat((bestAsk - bestBid).toFixed(digits)),
  };
}

/** timeframe available in the snapshot that should drive the book:
 *  `want` when it has enough candles, otherwise the finest available */
export function pickDomCandles(
  tfs: Record<string, { candles: Candle[] } | undefined>,
  want?: string | null
): { tf: string; candles: Candle[] } | null {
  if (want) {
    const snap = tfs[want];
    if (snap && snap.candles.length >= 40) return { tf: want, candles: snap.candles };
    return null;
  }
  const order = ["5m", "15m", "30m", "1h", "4h", "1d"];
  for (const tf of order) {
    const snap = tfs[tf];
    if (snap && snap.candles.length >= 40) return { tf, candles: snap.candles };
  }
  return null;
}

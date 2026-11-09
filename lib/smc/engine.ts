/**
 * SMC Analysis Engine
 * Detects: Market Structure (BOS / CHoCH), Real Order Blocks, Fair Value Gaps,
 * Liquidity (EQH/EQL), Buy/Sell Pressure (LuxAlgo DOM-style), Price-Action
 * regimes (range / channel / trend) with breakout & fake-breakout detection,
 * and builds a confluence-scored trade plan with entry / stop / targets.
 */

import { analyzePriceAction, type PriceAction } from "@/lib/smc/priceaction";

export interface Candle {
  t: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SwingPoint {
  i: number;
  t: number;
  price: number;
  type: "high" | "low";
}

export interface StructureEvent {
  i: number;
  t: number;
  price: number;
  type: "BOS" | "CHoCH";
  dir: "bullish" | "bearish";
}

export interface OrderBlock {
  kind: "demand" | "supply";
  top: number;
  bottom: number;
  i: number;
  t: number;
  state: "fresh" | "tapped" | "mitigated";
}

export interface FVG {
  kind: "bullish" | "bearish";
  top: number;
  bottom: number;
  i: number;
  t: number;
  filled: boolean;
}

export interface LiquidityLevel {
  kind: "EQH" | "EQL";
  price: number;
  count: number;
  t: number;
}

export interface Pressure {
  buyPct: number;
  sellPct: number;
  score: number; // -100 .. +100
}

/* Depth-of-Market style per-candle volume decomposition (LuxAlgo-like) */
export interface CandleFlow {
  t: number; // epoch seconds
  buy: number; // estimated buy volume
  sell: number; // estimated sell volume
  delta: number; // buy - sell
  cumDelta: number; // running cumulative delta
}

export interface FlowSummary {
  buyVol: number; // total buy volume over lookback
  sellVol: number; // total sell volume over lookback
  share: number; // -100..+100 (net buy dominance)
  cumDelta: number; // cumulative delta over lookback
  slope: number; // -1..+1 recent acceleration of cumDelta
  direction: "buyers" | "sellers" | "balanced";
  strength: number; // 0..100 conviction
  divergence: "bullish" | "bearish" | "none"; // price vs cumulative delta
}

export type PlanSide = "LONG" | "SHORT" | "WAIT";
export type PlanStatus = "in-zone" | "await-retrace" | "no-setup";

export interface TradePlan {
  side: PlanSide;
  status: PlanStatus;
  entry: number | null;
  entryZone: [number, number] | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr1: number | null;
  rr2: number | null;
  reasons: string[];
}

/** Both directional scenarios derived from real structure (OB / FVG / liquidity). */
export interface ScenarioPlans {
  long: TradePlan | null;
  short: TradePlan | null;
}

export type Signal = "STRONG BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG SELL";

export interface TFAnalysis {
  timeframe: string;
  price: number;
  atr: number;
  trend: "bullish" | "bearish" | "ranging";
  events: StructureEvent[];
  lastEvent: StructureEvent | null;
  barsSinceEvent: number;
  swings: SwingPoint[];
  orderBlocks: OrderBlock[];
  fvgs: FVG[];
  liquidity: LiquidityLevel[];
  pressure: Pressure;
  flow: FlowSummary;
  /** price-action regime + breakout / fake-breakout reads */
  priceAction: PriceAction;
  plan: TradePlan;
  /** both directional scenarios (null where no valid OB/FVG zone exists) */
  plans?: ScenarioPlans;
  score: number; // -100 .. +100 confluence
  signal: Signal;
  /** candles array start index relative to the array the analysis ran on */
  indexOffset: number;
}

const SWING_LEN = 3;
const ATR_LEN = 14;
const PRESSURE_LOOKBACK = 30;
const FLOW_LOOKBACK = 60;
const MAX_OBS = 8;
const MAX_FVGS = 6;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function atr(candles: Candle[], len = ATR_LEN): number {
  if (candles.length < 2) return 0;
  const n = Math.min(len, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - n; i < candles.length; i++) {
    const prevC = candles[i - 1].c;
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevC),
      Math.abs(candles[i].l - prevC)
    );
    sum += tr;
  }
  return sum / n;
}

export function findSwings(candles: Candle[], len = SWING_LEN): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = len; i < candles.length - len; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - len; j <= i + len; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isHigh = false;
      if (candles[j].l <= candles[i].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ i, t: candles[i].t, price: candles[i].h, type: "high" });
    if (isLow) out.push({ i, t: candles[i].t, price: candles[i].l, type: "low" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Market structure: BOS / CHoCH                                       */
/* ------------------------------------------------------------------ */

function findStructure(candles: Candle[], swings: SwingPoint[]) {
  const events: StructureEvent[] = [];
  let trend: "bullish" | "bearish" | "ranging" = "ranging";

  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");
  let refHigh: SwingPoint | null = null;
  let refLow: SwingPoint | null = null;
  let hi = 0;
  let lo = 0;

  for (let i = 0; i < candles.length; i++) {
    // a swing at index j is only "known" once j + SWING_LEN bars have closed
    while (hi < highs.length && highs[hi].i + SWING_LEN <= i) {
      if (!refHigh || highs[hi].i > refHigh.i) refHigh = highs[hi];
      hi++;
    }
    while (lo < lows.length && lows[lo].i + SWING_LEN <= i) {
      if (!refLow || lows[lo].i > refLow.i) refLow = lows[lo];
      lo++;
    }
    const c = candles[i].c;
    if (refHigh && c > refHigh.price) {
      events.push({
        i,
        t: candles[i].t,
        price: refHigh.price,
        type: trend === "bearish" ? "CHoCH" : "BOS",
        dir: "bullish",
      });
      trend = "bullish";
      refHigh = null;
    } else if (refLow && c < refLow.price) {
      events.push({
        i,
        t: candles[i].t,
        price: refLow.price,
        type: trend === "bullish" ? "CHoCH" : "BOS",
        dir: "bearish",
      });
      trend = "bearish";
      refLow = null;
    }
  }
  return { trend, events };
}

/* ------------------------------------------------------------------ */
/* Order blocks — last opposite candle before the structural break     */
/* ------------------------------------------------------------------ */

function findOrderBlocks(candles: Candle[], events: StructureEvent[]): OrderBlock[] {
  const obs: OrderBlock[] = [];
  for (const ev of events) {
    if (ev.i < 1) continue;
    let found = -1;
    const start = Math.max(0, ev.i - 30);
    for (let j = ev.i; j >= start; j--) {
      const bearish = candles[j].c < candles[j].o;
      const bullish = candles[j].c > candles[j].o;
      if (ev.dir === "bullish" && bearish) {
        found = j;
        break;
      }
      if (ev.dir === "bearish" && bullish) {
        found = j;
        break;
      }
    }
    if (found < 0) continue;

    const ob: OrderBlock =
      ev.dir === "bullish"
        ? {
            kind: "demand",
            top: candles[found].h,
            bottom: candles[found].l,
            i: found,
            t: candles[found].t,
            state: "fresh",
          }
        : {
            kind: "supply",
            top: candles[found].h,
            bottom: candles[found].l,
            i: found,
            t: candles[found].t,
            state: "fresh",
          };

    for (let k = found + 1; k < candles.length; k++) {
      if (ob.kind === "demand") {
        if (candles[k].c < ob.bottom) {
          ob.state = "mitigated";
          break;
        }
        if (candles[k].l <= ob.top) ob.state = "tapped";
      } else {
        if (candles[k].c > ob.top) {
          ob.state = "mitigated";
          break;
        }
        if (candles[k].h >= ob.bottom) ob.state = "tapped";
      }
    }
    obs.push(ob);
  }
  return obs.slice(-MAX_OBS);
}

/* ------------------------------------------------------------------ */
/* Fair Value Gaps                                                     */
/* ------------------------------------------------------------------ */

function findFVGs(candles: Candle[]): FVG[] {
  const out: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2];
    const b = candles[i];
    if (b.l > a.h) {
      out.push({
        kind: "bullish",
        top: b.l,
        bottom: a.h,
        i: i - 1,
        t: candles[i - 1].t,
        filled: false,
      });
    } else if (b.h < a.l) {
      out.push({
        kind: "bearish",
        top: a.l,
        bottom: b.h,
        i: i - 1,
        t: candles[i - 1].t,
        filled: false,
      });
    }
  }
  for (const f of out) {
    for (let k = f.i + 2; k < candles.length; k++) {
      if (f.kind === "bullish" && candles[k].l <= f.bottom) {
        f.filled = true;
        break;
      }
      if (f.kind === "bearish" && candles[k].h >= f.top) {
        f.filled = true;
        break;
      }
    }
  }
  const open = out.filter((f) => !f.filled);
  return open.slice(-MAX_FVGS);
}

/* ------------------------------------------------------------------ */
/* Liquidity: Equal Highs / Equal Lows                                 */
/* ------------------------------------------------------------------ */

function findLiquidity(candles: Candle[], swings: SwingPoint[], a: number): LiquidityLevel[] {
  const tol = a > 0 ? a * 0.3 : 0;
  if (tol <= 0) return [];
  const levels: LiquidityLevel[] = [];

  const cluster = (pts: SwingPoint[], kind: "EQH" | "EQL") => {
    const sorted = [...pts].sort((x, y) => x.price - y.price);
    const used = new Set<number>();
    for (let i = 0; i < sorted.length; i++) {
      if (used.has(i)) continue;
      // anchor-based clustering: every member must be within tol of the anchor
      const anchor = sorted[i];
      const group: SwingPoint[] = [anchor];
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(sorted[j].price - anchor.price) <= tol) {
          group.push(sorted[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const price =
          kind === "EQH"
            ? Math.max(...group.map((g) => g.price))
            : Math.min(...group.map((g) => g.price));
        levels.push({ kind, price, count: group.length, t: anchor.t });
      }
    }
  };

  cluster(swings.filter((s) => s.type === "high"), "EQH");
  cluster(swings.filter((s) => s.type === "low"), "EQL");

  // keep only the most relevant levels around current price (nearest few)
  const price = candles.length ? candles[candles.length - 1].c : 0;
  const eqh = levels
    .filter((l) => l.kind === "EQH" && l.price > price)
    .sort((x, y) => x.price - y.price)
    .slice(0, 3);
  const eql = levels
    .filter((l) => l.kind === "EQL" && l.price < price)
    .sort((x, y) => y.price - x.price)
    .slice(0, 3);
  return [...eqh, ...eql];
}

/* ------------------------------------------------------------------ */
/* Buy / Sell pressure (LuxAlgo DOM-style approximation)               */
/* ------------------------------------------------------------------ */

/** Per-candle buy/sell volume decomposition with running cumulative delta. */
export function flowSeries(candles: Candle[], lookback = FLOW_LOOKBACK): CandleFlow[] {
  const start = Math.max(0, candles.length - lookback);
  const out: CandleFlow[] = [];
  let cum = 0;
  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const r = c.h - c.l;
    let buy = 0;
    let sell = 0;
    if (r > 0) {
      if (c.v > 0) {
        // real (tick) volume: split by where the close sits inside the range
        buy = (c.v * (c.c - c.l)) / r;
        sell = (c.v * (c.h - c.c)) / r;
      } else {
        // no volume feed: body + wick anatomy model
        const body = Math.abs(c.c - c.o);
        buy = body * 0.6 + (c.c - c.l) * 0.4;
        sell = body * 0.6 + (c.h - c.c) * 0.4;
      }
    }
    const delta = buy - sell;
    cum += delta;
    out.push({ t: c.t, buy, sell, delta, cumDelta: cum });
  }
  return out;
}

/**
 * Price-vs-cumulative-delta divergence (absorption / exhaustion read).
 * bullish  -> price makes a lower low while cumDelta makes a higher low
 *             (sellers being absorbed by passive buyers).
 * bearish  -> price makes a higher high while cumDelta makes a lower high
 *             (buyers exhausted, smart money distributing).
 */
function detectDivergence(candles: Candle[], flows: CandleFlow[]): "bullish" | "bearish" | "none" {
  const n = Math.min(candles.length, flows.length);
  if (n < 24) return "none";
  const start = candles.length - n;
  const window = candles.slice(start, start + n);
  const swings = findSwings(window, 2);
  const recent = swings.filter((s) => n - 1 - s.i <= 20);
  const lows = recent.filter((s) => s.type === "low").slice(-2);
  const highs = recent.filter((s) => s.type === "high").slice(-2);
  if (lows.length === 2) {
    const [a, b] = lows;
    const da = flows[a.i].cumDelta;
    const db = flows[b.i].cumDelta;
    if (b.price < a.price && db > da + Math.abs(da) * 0.02) return "bullish";
  }
  if (highs.length === 2) {
    const [a, b] = highs;
    const da = flows[a.i].cumDelta;
    const db = flows[b.i].cumDelta;
    if (b.price > a.price && db < da - Math.abs(da) * 0.02) return "bearish";
  }
  return "none";
}

export function calcFlow(candles: Candle[], lookback = FLOW_LOOKBACK): FlowSummary {
  const flows = flowSeries(candles, lookback);
  let buy = 0;
  let sell = 0;
  for (const f of flows) {
    buy += f.buy;
    sell += f.sell;
  }
  const tot = buy + sell;
  const share = tot > 0 ? ((buy - sell) / tot) * 100 : 0;
  const cumDelta = flows.length ? flows[flows.length - 1].cumDelta : 0;
  // recent acceleration: last third of the window vs its volume
  const third = Math.max(1, Math.floor(flows.length / 3));
  const recent = flows.slice(-third);
  let rBuy = 0;
  let rSell = 0;
  for (const f of recent) {
    rBuy += f.buy;
    rSell += f.sell;
  }
  const rTot = rBuy + rSell;
  const slope = rTot > 0 ? Math.max(-1, Math.min(1, (rBuy - rSell) / rTot)) : 0;
  const direction = share >= 8 ? "buyers" : share <= -8 ? "sellers" : "balanced";
  return {
    buyVol: Math.round(buy),
    sellVol: Math.round(sell),
    share: Math.round(share * 10) / 10,
    cumDelta: Math.round(cumDelta),
    slope: Math.round(slope * 100) / 100,
    direction,
    strength: Math.min(100, Math.round(Math.abs(share) * 2)),
    divergence: detectDivergence(candles, flows),
  };
}

export function calcPressure(candles: Candle[], lookback = PRESSURE_LOOKBACK): Pressure {
  const n = Math.min(lookback, candles.length);
  let buy = 0;
  let sell = 0;
  const startIdx = candles.length - n;
  for (let i = startIdx; i < candles.length; i++) {
    const { o, h, l, c, v } = candles[i];
    const r = h - l;
    if (r <= 0) continue;
    const w = 1 + ((i - startIdx) / Math.max(n - 1, 1)) * 0.5; // recency weight 1..1.5
    let b: number;
    let s: number;
    if (v > 0) {
      b = (v * (c - l)) / r;
      s = (v * (h - c)) / r;
    } else {
      // no volume (forex spot) -> decompose body + wicks
      b = (Math.max(c - o, 0) * 0.6 + (c - l) * 0.4) / r;
      s = (Math.max(o - c, 0) * 0.6 + (h - c) * 0.4) / r;
    }
    buy += b * w;
    sell += s * w;
  }
  const tot = buy + sell;
  const buyPct = tot > 0 ? Math.round((100 * buy) / tot) : 50;
  const clamped = Math.min(95, Math.max(5, buyPct));
  return { buyPct: clamped, sellPct: 100 - clamped, score: (clamped - 50) * 2 };
}

/* ------------------------------------------------------------------ */
/* Trade plan                                                          */
/* ------------------------------------------------------------------ */

function buildPlan(
  candles: Candle[],
  trend: "bullish" | "bearish" | "ranging",
  lastEvent: StructureEvent | null,
  barsSinceEvent: number,
  obs: OrderBlock[],
  fvgs: FVG[],
  liq: LiquidityLevel[],
  pressure: Pressure,
  a: number,
  price: number,
  force?: "LONG" | "SHORT"
): TradePlan {
  const reasons: string[] = [];
  const plan: TradePlan = {
    side: "WAIT",
    status: "no-setup",
    entry: null,
    entryZone: null,
    stop: null,
    tp1: null,
    tp2: null,
    rr1: null,
    rr2: null,
    reasons,
  };

  if (lastEvent) {
    reasons.push(
      `${lastEvent.dir === "bullish" ? "Bullish" : "Bearish"} ${lastEvent.type} ${barsSinceEvent} bars ago`
    );
  }
  reasons.push(`Buy pressure ${pressure.buyPct}% / Sell ${pressure.sellPct}%`);

  // decide side
  let side: PlanSide = "WAIT";
  if (force) side = force;
  else if (trend === "bullish" && pressure.score > -40) side = "LONG";
  else if (trend === "bearish" && pressure.score < 40) side = "SHORT";
  else if (trend === "ranging") {
    if (pressure.score >= 35) side = "LONG";
    else if (pressure.score <= -35) side = "SHORT";
  }
  plan.side = side;
  if (side === "WAIT") {
    reasons.push("No clear structure + pressure alignment — stand aside");
    return plan;
  }

  const wantKind = side === "LONG" ? "demand" : "supply";
  // zone candidates: unmitigated OBs on the right side of price
  let zone: OrderBlock | null = null;
  const cands = obs.filter((ob) => ob.kind === wantKind && ob.state !== "mitigated");
  if (side === "LONG") {
    // prefer an OB we are currently inside
    zone =
      cands.find((ob) => price >= ob.bottom && price <= ob.top) ??
      cands.filter((ob) => ob.top < price).sort((x, y) => y.top - x.top)[0] ??
      null;
  } else {
    zone =
      cands.find((ob) => price >= ob.bottom && price <= ob.top) ??
      cands.filter((ob) => ob.bottom > price).sort((x, y) => x.bottom - y.bottom)[0] ??
      null;
  }

  // fallback: FVG as entry zone
  let zoneIsFvg = false;
  if (!zone) {
    const wantFvg = side === "LONG" ? "bullish" : "bearish";
    const fc = fvgs.filter((f) => f.kind === wantFvg);
    if (side === "LONG") {
      const f =
        fc.find((g) => price >= g.bottom && price <= g.top) ??
        fc.filter((g) => g.top < price).sort((x, y) => y.top - x.top)[0];
      if (f) {
        zone = { kind: "demand", top: f.top, bottom: f.bottom, i: f.i, t: f.t, state: "fresh" };
        zoneIsFvg = true;
      }
    } else {
      const f =
        fc.find((g) => price >= g.bottom && price <= g.top) ??
        fc.filter((g) => g.bottom > price).sort((x, y) => x.bottom - y.bottom)[0];
      if (f) {
        zone = { kind: "supply", top: f.top, bottom: f.bottom, i: f.i, t: f.t, state: "fresh" };
        zoneIsFvg = true;
      }
    }
  }

  if (!zone) {
    reasons.push("No fresh POI (OB/FVG) nearby — wait for a new zone");
    return plan;
  }

  const inZone = price >= zone.bottom && price <= zone.top;
  plan.status = inZone ? "in-zone" : "await-retrace";
  plan.entryZone = [zone.bottom, zone.top];
  plan.entry = inZone ? price : side === "LONG" ? zone.top : zone.bottom;
  const buffer = a * 0.5;
  plan.stop = side === "LONG" ? zone.bottom - buffer : zone.top + buffer;

  const risk = Math.abs(plan.entry - plan.stop);
  if (risk <= 0) {
    reasons.push("Invalid risk geometry — skip");
    return plan;
  }

  // targets: liquidity first, else R multiples (cap target search at 8R to stay realistic)
  const above = liq
    .filter((l) => {
      if (side === "LONG") {
        return l.price > plan.entry! + risk * 0.5 && l.price < plan.entry! + risk * 8;
      }
      return l.price < plan.entry! - risk * 0.5 && l.price > plan.entry! - risk * 8;
    })
    .sort((x, y) => (side === "LONG" ? x.price - y.price : y.price - x.price));
  const tp1Liq = above[0];
  const tp2Liq = above[1];
  plan.tp1 = tp1Liq
    ? tp1Liq.price
    : side === "LONG"
      ? plan.entry + risk * 1.5
      : plan.entry - risk * 1.5;
  plan.tp2 = tp2Liq
    ? tp2Liq.price
    : side === "LONG"
      ? plan.entry + risk * 2.5
      : plan.entry - risk * 2.5;
  plan.rr1 = Math.round((Math.abs(plan.tp1 - plan.entry) / risk) * 10) / 10;
  plan.rr2 = Math.round((Math.abs(plan.tp2 - plan.entry) / risk) * 10) / 10;

  const rnd = (v: number) => parseFloat(v.toPrecision(7));
  reasons.push(
    `${zoneIsFvg ? "FVG zone" : `${zone.state === "fresh" ? "Fresh" : "Tapped"} ${zone.kind} OB`} ${rnd(zone.bottom)}–${rnd(zone.top)}`
  );
  if (plan.status === "in-zone") reasons.push("Price is inside the zone NOW");
  const nearLiq = liq
    .filter((l) => Math.abs(l.price - price) < a * 2)
    .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price))[0];
  if (nearLiq) reasons.push(`Nearest liquidity ${nearLiq.kind} ×${nearLiq.count} @ ${rnd(nearLiq.price)}`);
  return plan;
}

/* ------------------------------------------------------------------ */
/* Main analyze                                                        */
/* ------------------------------------------------------------------ */

function signalFromScore(s: number): Signal {
  if (s >= 45) return "STRONG BUY";
  if (s >= 18) return "BUY";
  if (s <= -45) return "STRONG SELL";
  if (s <= -18) return "SELL";
  return "NEUTRAL";
}

export function analyze(candles: Candle[], timeframe: string, indexOffset = 0): TFAnalysis {
  const price = candles.length ? candles[candles.length - 1].c : 0;
  const a = atr(candles);
  const swings = findSwings(candles);
  const { trend, events } = findStructure(candles, swings);
  const lastEvent = events.length ? events[events.length - 1] : null;
  const barsSinceEvent = lastEvent ? candles.length - 1 - lastEvent.i : -1;
  const orderBlocks = findOrderBlocks(candles, events);
  const fvgs = findFVGs(candles);
  const liquidity = findLiquidity(candles, swings, a);
  const pressure = calcPressure(candles);
  const flow = calcFlow(candles);
  const priceAction = analyzePriceAction(candles, trend);
  const plan = buildPlan(
    candles,
    trend,
    lastEvent,
    barsSinceEvent,
    orderBlocks,
    fvgs,
    liquidity,
    pressure,
    a,
    price
  );
  // both directional scenarios from real structure — used for chart drawing
  const planLong =
    plan.side === "LONG"
      ? plan
      : buildPlan(candles, trend, lastEvent, barsSinceEvent, orderBlocks, fvgs, liquidity, pressure, a, price, "LONG");
  const planShort =
    plan.side === "SHORT"
      ? plan
      : buildPlan(candles, trend, lastEvent, barsSinceEvent, orderBlocks, fvgs, liquidity, pressure, a, price, "SHORT");
  const plans: ScenarioPlans = {
    long: planLong.entry != null ? planLong : null,
    short: planShort.entry != null ? planShort : null,
  };

  // confluence score
  let score = 0;
  score += trend === "bullish" ? 35 : trend === "bearish" ? -35 : 0;
  if (lastEvent && barsSinceEvent >= 0 && barsSinceEvent <= 12) {
    score += lastEvent.dir === "bullish" ? 10 : -10;
  }
  score += pressure.score * 0.25; // ±25
  score += Math.max(-10, Math.min(10, flow.share * 0.1)); // DOM flow ±10
  if (plan.status === "in-zone") score += plan.side === "LONG" ? 15 : -15;
  else if (plan.status === "await-retrace") score += plan.side === "LONG" ? 7 : -7;
  // sweep bonus: recent event + liquidity nearby
  if (lastEvent && barsSinceEvent >= 0 && barsSinceEvent <= 20) {
    const near = liquidity.find((l) => Math.abs(l.price - price) < a * 1.5);
    if (near) score += lastEvent.dir === "bullish" ? 4 : -4;
  }
  score = Math.max(-100, Math.min(100, Math.round(score)));

  return {
    timeframe,
    price,
    atr: a,
    trend,
    events,
    lastEvent,
    barsSinceEvent,
    swings,
    orderBlocks,
    fvgs,
    liquidity,
    pressure,
    flow,
    priceAction,
    plan,
    plans,
    score,
    signal: signalFromScore(score),
    indexOffset,
  };
}

/** Multi-timeframe combined verdict */
export function combineSignal(scores: Record<string, number>): {
  score: number;
  signal: Signal;
} {
  const w: Record<string, number> = {
    "5m": 0.1,
    "15m": 0.15,
    "30m": 0.2,
    "1h": 0.25,
    "4h": 0.2,
    "1d": 0.1,
  };
  let total = 0;
  let wsum = 0;
  for (const k of Object.keys(w)) {
    if (typeof scores[k] === "number") {
      total += scores[k] * w[k];
      wsum += w[k];
    }
  }
  const score = wsum > 0 ? Math.round(total / wsum) : 0;
  return { score, signal: signalFromScore(score) };
}

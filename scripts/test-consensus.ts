/* Sanity test for the v7.6 unified theory (consensus with 7 voters). */
import { computeConsensus } from "../src/lib/smc/consensus";
import type { TFAnalysis, TradePlan } from "../src/lib/smc/engine";
import type { PriceAction } from "../src/lib/smc/priceaction";
import type { AIVerdict } from "../src/lib/smc/ai-types";
import type { DomData } from "../src/hooks/use-dom";

const pa = (over: Partial<PriceAction> = {}): PriceAction => ({
  regime: "range",
  range: { hi: 3900, lo: 3870, hiTouches: 3, loTouches: 3, widthAtr: 3, widthPct: 0.8, bars: 40, pos: 50, iStart: 0 },
  channel: null,
  breakouts: [],
  fakeouts: [],
  status: "رنج",
  notes: [],
  ...over,
});

const plan = (side: TradePlan["side"], status: TradePlan["status"] = "in-zone"): TradePlan => ({
  side,
  status,
  entry: side === "SHORT" ? 3885 : 3860,
  entryZone: side === "SHORT" ? [3884, 3890] : [3856, 3862],
  stop: side === "SHORT" ? 3898 : 3850,
  tp1: side === "SHORT" ? 3862 : 3878,
  tp2: side === "SHORT" ? 3845 : 3890,
  rr1: 1.8,
  rr2: 3.1,
  reasons: [],
});

const ana = (over: Partial<TFAnalysis>): TFAnalysis =>
  ({
    timeframe: "5m",
    price: 3875.64,
    atr: 3.2,
    trend: "bearish",
    events: [],
    lastEvent: { type: "BOS", dir: "bearish", price: 3872, i: 10, t: 0, from: 3880, to: 3872 },
    barsSinceEvent: 4,
    swings: [],
    orderBlocks: [],
    fvgs: [],
    liquidity: [],
    pressure: { buyPct: 45, sellPct: 55 },
    flow: { direction: "sellers", share: -12, cumDelta: -320, slope: -8, buyVol: 4200, sellVol: 5400, divergence: "none" },
    priceAction: pa({ regime: "channel-down", channel: { slopePerBar: -0.4, mid0: 3905, halfWidth: 9, iStart: 0, iEnd: 59, strength: 78, widthAtr: 2.4, type: "descending", pos: 55, upper: 3884, lower: 3866, mid: 3875 } }),
    plan: plan("SHORT"),
    score: -45,
    signal: "SELL",
    indexOffset: 0,
    ...over,
  }) as TFAnalysis;

const dom: DomData = {
  symbol: "XAUUSD",
  digits: 2,
  price: 3875.64,
  timeframe: "5m",
  source: "tradingview",
  t: Date.now(),
  tick: 0.5,
  levels: [],
  imbalance: -18,
  buyTotal: 4100,
  sellTotal: 5900,
  maxVol: 900,
  walls: { bid: { p: 3870, v: 850 }, ask: { p: 3881, v: 780 } },
  spread: 0.5,
};

const ai = (signal: AIVerdict["signal"], confidence: number): AIVerdict => ({
  signal,
  confidence,
  entry: 3876,
  stop: 3888,
  tp1: 3858,
  tp2: 3846,
  timeframe: "5m",
  flowRead: "",
  reasoning: [],
  invalidation: "",
});

// 1) everything bearish
const c1 = computeConsensus({ score: -45 }, ai("SELL", 78), dom, ana({}));
console.log("1) ALL-BEARISH →", c1.dir, c1.score + "% |", c1.headline);
console.log("   voters:", c1.votes.map((v) => `${v.fa}:${v.agree > 0 ? "+" : v.agree < 0 ? "-" : "0"}(${Math.round(v.weight * 100)}%)`).join(" "));
console.log("   levels:", c1.entry, c1.stop, c1.tp1, c1.tp2, "| rr1:", c1.rr1);

// 2) recent fakeout UP (trap) on top of bearish — should push pa further negative
const c2 = computeConsensus(
  { score: -30 },
  ai("SELL", 64),
  dom,
  ana({ priceAction: pa({ regime: "range", fakeouts: [{ dir: "up", boundary: 3900, i: 58, t: 0, barsAgo: 1, strength: 70, wickOnly: true, reclaim: false, source: "range" }] }) })
);
console.log("2) FAKE-UP →", c2.dir, c2.score + "% | pa vote:", c2.votes.find((v) => v.id === "pa")?.detail);

// 3) AI BUY vs everything else SHORT — conflict
const c3 = computeConsensus({ score: -45 }, ai("BUY", 90), dom, ana({}));
console.log("3) CONFLICT →", c3.dir, c3.score + "% |", c3.headline);

// 4) no AI, no DOM — engine only
const c4 = computeConsensus({ score: -45 }, null, null, ana({}));
console.log("4) NO-AI/NO-DOM →", c4.dir, c4.score + "% |", c4.headline, "| source:", c4.source);

// 5) WAIT when everything is neutral
const c5 = computeConsensus(
  { score: 0 },
  ai("WAIT", 50),
  { ...dom, imbalance: 2 },
  ana({ trend: "ranging", score: 0, signal: "NEUTRAL", flow: { direction: "neutral", share: 1, cumDelta: 5, slope: 0, buyVol: 100, sellVol: 100, divergence: "none" }, priceAction: pa({ regime: "range" }), plan: plan("WAIT") })
);
console.log("5) NEUTRAL →", c5.dir, c5.score + "% |", c5.headline);

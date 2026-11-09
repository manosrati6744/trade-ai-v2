/**
 * Unit test — per-timeframe resolved positions (v7.7).
 * Run: npx tsx scripts/test-tfpositions.ts
 */
import { buildTfPosition, tfPositionReason } from "../src/lib/smc/tfpositions";
import type { TFAnalysis } from "../src/lib/smc/engine";
import type { PriceAction } from "../src/lib/smc/priceaction";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
  }
}

const pa: PriceAction = {
  regime: "range",
  range: { hi: 3900, lo: 3860, hiTouches: 3, loTouches: 2, widthAtr: 2.1, widthPct: 1.0, bars: 20, pos: 30, iStart: 0 },
  channel: null,
  breakouts: [],
  fakeouts: [],
  status: "رنج",
  notes: [],
};

function mkAnalysis(over: Partial<TFAnalysis>): TFAnalysis {
  return {
    timeframe: "15m",
    price: 3875,
    atr: 8,
    trend: "bearish",
    events: [],
    lastEvent: { i: 98, t: 0, price: 3880, type: "CHoCH", dir: "bearish" },
    barsSinceEvent: 2,
    swings: [],
    orderBlocks: [
      { kind: "supply", top: 3890, bottom: 3884, i: 90, t: 0, state: "fresh" },
      { kind: "demand", top: 3870, bottom: 3864, i: 95, t: 0, state: "tapped" },
    ],
    fvgs: [{ kind: "bearish", top: 3882, bottom: 3878, i: 97, t: 0, filled: false }],
    liquidity: [{ kind: "EQL", price: 3855, count: 2, t: 0 }],
    pressure: { buyPct: 40, sellPct: 60, score: -30 },
    flow: {
      buyVol: 100,
      sellVol: 150,
      share: -20,
      cumDelta: -50,
      slope: -0.3,
      direction: "sellers",
      strength: 55,
      divergence: "none",
    },
    priceAction: pa,
    plan: { side: "WAIT", status: "no-setup", entry: null, entryZone: null, stop: null, tp1: null, tp2: null, rr1: null, rr2: null, reasons: [] },
    score: -35,
    signal: "SELL",
    indexOffset: 0,
    ...over,
  } as TFAnalysis;
}

console.log("1) bearish TF + short scenario → SHORT with plan levels");
const shortA = mkAnalysis({
  plans: {
    long: null,
    short: {
      side: "SHORT",
      status: "await-retrace",
      entry: 3884,
      entryZone: [3884, 3890],
      stop: 3893,
      tp1: 3866,
      tp2: 3855,
      rr1: 2.0,
      rr2: 3.2,
      reasons: ["OB عرضه"],
    },
  },
});
const p1 = buildTfPosition(shortA);
check("dir SHORT", p1.dir === "SHORT");
check("levels from short scenario", p1.entry === 3884 && p1.stop === 3893 && p1.tp1 === 3866 && p1.tp2 === 3855);
check("rr1 2", p1.rr1 === 2);
check("reason has CHoCH + sellers", p1.reason.includes("CHoCH") && p1.reason.includes("فروشندگان"));

console.log("2) neutral score + long scenario in-zone → LONG (zone evidence)");
const longA = mkAnalysis({
  score: 0,
  signal: "NEUTRAL",
  trend: "ranging",
  plans: {
    long: {
      side: "LONG",
      status: "in-zone",
      entry: 3866,
      entryZone: [3864, 3870],
      stop: 3858,
      tp1: 3888,
      tp2: 3899,
      rr1: 3.7,
      rr2: 5.5,
      reasons: ["OB تقاضا"],
    },
    short: null,
  },
});
const p2 = buildTfPosition(longA);
check("dir LONG via in-zone fallback", p2.dir === "LONG");
check("status in-zone", p2.status === "in-zone");

console.log("3) recent opposite fakeout → WAIT");
const fakeA = mkAnalysis({
  priceAction: {
    ...pa,
    fakeouts: [{ dir: "down", boundary: 3860, i: 99, t: 0, barsAgo: 1, strength: 70, wickOnly: true, reclaim: false, source: "range" }],
  },
});
const p3 = buildTfPosition(fakeA);
check("WAIT on opposite fakeout (short blocked)", p3.dir === "WAIT");
check("reason mentions فیک‌شکست or تله", p3.reason.includes("فیک‌شکست") || p3.reason.includes("تله"));

console.log("4) no scenarios at all → WAIT, no crash");
const p4 = buildTfPosition(mkAnalysis({ plans: undefined, score: -35 }));
check("WAIT", p4.dir === "WAIT");
check("reason non-empty", p4.reason.length > 10);

console.log("5) bullish TF + long scenario → LONG with levels");
const bull = mkAnalysis({
  trend: "bullish",
  score: 40,
  signal: "BUY",
  lastEvent: { i: 99, t: 0, price: 3880, type: "BOS", dir: "bullish" },
  flow: { buyVol: 200, sellVol: 80, share: 43, cumDelta: 120, slope: 0.5, direction: "buyers", strength: 70, divergence: "none" },
  plans: {
    long: {
      side: "LONG",
      status: "await-retrace",
      entry: 3870,
      entryZone: [3864, 3870],
      stop: 3862,
      tp1: 3895,
      tp2: 3910,
      rr1: 3.1,
      rr2: 5,
      reasons: [],
    },
    short: null,
  },
});
const p5 = buildTfPosition(bull);
check("dir LONG", p5.dir === "LONG");
check("reason has BOS + buyers", p5.reason.includes("BOS") && p5.reason.includes("خریداران"));

console.log(`\nResult: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);

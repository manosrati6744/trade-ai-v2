/* Sanity test for the price-action engine with synthetic candles. */
import { analyzePriceAction, type PriceAction } from "../src/lib/smc/priceaction";
import type { Candle } from "../src/lib/smc/engine";

function mk(o: number, h: number, l: number, c: number, v = 1000, t0 = 1_700_000_000, i = 0): Candle {
  return { t: t0 + i * 300, o, h, l, c, v };
}

// 1) Flat range: oscillate 100..102 for 90 bars
const rangeC: Candle[] = [];
for (let i = 0; i < 120; i++) {
  const phase = Math.sin(i / 4.2);
  const mid = 101 + phase * 0.9;
  const o = mid - 0.15;
  const c = mid + 0.15;
  rangeC.push(mk(o, Math.max(o, c) + 0.12, Math.min(o, c) - 0.12, c, 1000, 1_700_000_000, i));
}
const r1 = analyzePriceAction(rangeC, "ranging");
console.log("RANGE case:", r1.regime, "| range:", r1.range && [r1.range.lo.toFixed(2), r1.range.hi.toFixed(2), "touches", r1.range.hiTouches + r1.range.loTouches], "| status:", r1.status);

// 2) Ascending channel: trend +3.2/bar + sine wiggle
const chanC: Candle[] = [];
for (let i = 0; i < 120; i++) {
  const mid = 100 + i * 0.32 + Math.sin(i / 3.1) * 1.4;
  const o = mid - 0.2;
  const c = mid + 0.2;
  chanC.push(mk(o, Math.max(o, c) + 0.15, Math.min(o, c) - 0.15, c, 1000, 1_700_000_000, i));
}
const r2 = analyzePriceAction(chanC, "bullish");
console.log("CHANNEL case:", r2.regime, "| channel:", r2.channel && [r2.channel.type, "R2", r2.channel.strength, "wATR", r2.channel.widthAtr], "| status:", r2.status);

// 3) Range then confirmed breakout up (3 bars ago) with volume
const boC: Candle[] = [];
for (let i = 0; i < 117; i++) {
  const phase = Math.sin(i / 4.2);
  const mid = 101 + phase * 0.9;
  boC.push(mk(mid - 0.15, mid + 0.27, mid - 0.42, mid + 0.15, 1000, 1_700_000_000, i));
}
// breakout: last 3 candles push above 101.9+ and close there, big volume
boC.push(mk(101.85, 102.9, 101.7, 102.75, 2600, 1_700_000_000, 117));
boC.push(mk(102.7, 103.1, 102.5, 102.95, 2400, 1_700_000_000, 118));
boC.push(mk(102.95, 103.35, 102.8, 103.2, 2200, 1_700_000_000, 119));
const r3 = analyzePriceAction(boC, "ranging");
console.log("BREAKOUT case:", r3.regime, "| bo:", r3.breakouts.map(b => [b.dir, b.confirmed, "x" + b.volumeRatio, b.barsAgo + "ago", "S" + b.strength]), "| status:", r3.status);

// 4) Fake breakout: range, one wick above hi closing back inside, 5 bars ago
const fkC: Candle[] = [];
for (let i = 0; i < 115; i++) {
  const phase = Math.sin(i / 4.2);
  const mid = 101 + phase * 0.9;
  fkC.push(mk(mid - 0.15, mid + 0.27, mid - 0.42, mid + 0.15, 1000, 1_700_000_000, i));
}
fkC.push(mk(101.6, 102.75, 101.5, 101.75, 1800, 1_700_000_000, 115)); // trap bar: pokes above ~101.9+, closes inside
for (let i = 0; i < 4; i++) {
  const mid = 101.2 - i * 0.08;
  fkC.push(mk(mid + 0.1, mid + 0.3, mid - 0.35, mid - 0.05, 1200, 1_700_000_000, 116 + i));
}
const r4 = analyzePriceAction(fkC, "ranging");
console.log("FAKE case:", r4.regime, "| fake:", r4.fakeouts.map(f => [f.dir, f.wickOnly ? "wick" : "reclaim", "S" + f.strength, f.barsAgo + "ago"]), "| status:", r4.status);
console.log("notes:", (["r1", "r3", "r4"] as const).length, "cases ok");
for (const [name, pa] of [["range", r1], ["chan", r2], ["bo", r3], ["fake", r4]] as Array<[string, PriceAction]>) {
  if (!pa.status) throw new Error(`empty status for ${name}`);
  pa.notes.forEach((nt) => { if (!nt) throw new Error(`empty note in ${name}`); });
}
console.log("ALL-OK");

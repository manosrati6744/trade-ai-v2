// Quick engine test against real Yahoo data (run with: bun scripts/test-engine.ts)
import { analyze, combineSignal, type Candle } from "../src/lib/smc/engine";

const SYMBOLS: Record<string, string> = {
  XAUUSD: "GC=F",
  USOIL: "CL=F",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
};
const TFS = [
  { id: "5m", interval: "5m", range: "5d" },
  { id: "15m", interval: "15m", range: "10d" },
  { id: "30m", interval: "30m", range: "20d" },
  { id: "1h", interval: "60m", range: "30d" },
];

async function fetchCandles(yahoo: string, interval: string, range: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahoo
  )}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error("empty result");
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ t: ts[i], o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return out;
}

async function main() {
  for (const [sym, yahoo] of Object.entries(SYMBOLS)) {
    console.log(`\n=========== ${sym} (${yahoo}) ===========`);
    const scores: Record<string, number> = {};
    for (const tf of TFS) {
      try {
        const candles = await fetchCandles(yahoo, tf.interval, tf.range);
        const a = analyze(candles, tf.id);
        scores[tf.id] = a.score;
        console.log(
          `[${tf.id}] n=${candles.length} price=${a.price.toFixed(4)} atr=${a.atr.toFixed(4)} ` +
            `trend=${a.trend} last=${a.lastEvent ? a.lastEvent.type + "/" + a.lastEvent.dir + " (" + a.barsSinceEvent + " bars ago)" : "none"} ` +
            `pressure=${a.pressure.buyPct}/${a.pressure.sellPct} score=${a.score} signal=${a.signal}`
        );
        console.log(
          `    plan: ${a.plan.side} ${a.plan.status} entry=${a.plan.entry ?? "-"} stop=${a.plan.stop ?? "-"} ` +
            `tp1=${a.plan.tp1 ?? "-"} (RR ${a.plan.rr1 ?? "-"}) tp2=${a.plan.tp2 ?? "-"} (RR ${a.plan.rr2 ?? "-"})`
        );
        console.log(
          `    OBs=${a.orderBlocks.length} (${a.orderBlocks.map((o) => o.kind[0].toUpperCase() + ":" + o.state[0]).join(" ")}) ` +
            `FVGs=${a.fvgs.length} liq=${a.liquidity.map((l) => l.kind + "x" + l.count).join(",") || "-"}`
        );
      } catch (e) {
        console.log(`[${tf.id}] ERROR: ${e}`);
      }
    }
    console.log(`  => combined: ${JSON.stringify(combineSignal(scores))}`);
  }
}
main();

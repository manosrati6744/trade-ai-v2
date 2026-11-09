/**
 * SNIPER AI endpoint.
 *
 * Feeds the structured SMC snapshot (structure, order blocks, FVG, liquidity,
 * per-TF buy/sell volume flow & cumulative delta) to the GLM model with a
 * strict analyst persona, returns ONE precise verdict:
 * signal / confidence / entry / stop / tp1 / tp2 / reasoning / invalidation.
 *
 * Every verdict is tracked by the adaptive brain (win/loss journal), whose
 * factors are fed back into the next prompt — a closed learning loop.
 */

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { SYMBOLS } from "@/lib/smc/symbols";
import { faBidi, faDivergence, faDir, faSide, faSignal, faTF, faTrend } from "@/lib/ai/fa";
import { getSnapshot } from "@/lib/smc/server";
import { combineSignal, type TFAnalysis } from "@/lib/smc/engine";
import { computeConsensus } from "@/lib/smc/consensus";
import { buildTfPosition } from "@/lib/smc/tfpositions";
import { buildDomBook, pickDomCandles } from "@/lib/smc/dom";
import { TF_LABEL } from "@/lib/smc/symbols";
import { computePerformance } from "@/lib/smc/performance";
import { pushSignal, maybeDailyStats, FA_SYMBOL } from "@/lib/telegram/telegram";
import {
  brainStats,
  loadBrain,
  trackVerdict,
  type AIVerdict,
  type BrainState,
} from "@/lib/ai/brain";
import {
  appendMessage,
  buildEntryMessage,
  buildExitMessage,
  buildNoteMessage,
  entryEmitDecision,
  loadFeed,
} from "@/lib/ai/messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERDICT_TTL = 90_000;
const verdictCache = new Map<string, { ts: number; verdict: AIVerdict; engine: boolean }>();
const inflight = new Map<string, Promise<AIVerdict | null>>();

/* ------------------------------------------------------------------ */
/* Deterministic fallback (engine verdict when GLM is unavailable)     */
/* ------------------------------------------------------------------ */

function fmt(v: number | null | undefined, d: number): string {
  return v == null || !isFinite(v) ? "—" : v.toFixed(d);
}

function fallbackVerdict(
  data: Awaited<ReturnType<typeof getSnapshot>>,
  brain: BrainState
): AIVerdict {
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.tfs)) scores[k] = v.analysis.score;
  const combined = combineSignal(scores);
  const signal: AIVerdict["signal"] =
    combined.score >= 18 ? "BUY" : combined.score <= -18 ? "SELL" : "WAIT";

  const tfOrder = ["1h", "30m", "15m", "4h", "5m", "1d"];
  let pick = data.tfs["1h"]?.analysis;
  for (const k of tfOrder) {
    const a = data.tfs[k]?.analysis;
    if (!a) continue;
    if (
      (signal === "BUY" && a.plan.side === "LONG") ||
      (signal === "SELL" && a.plan.side === "SHORT")
    ) {
      pick = a;
      break;
    }
  }
  const a = pick ?? data.tfs["5m"]?.analysis ?? data.tfs["15m"]?.analysis ?? data.tfs["30m"]?.analysis;
  const plan = a?.plan;
  const flow = a?.flow;
  return {
    signal,
    confidence: Math.min(88, Math.max(35, 40 + Math.abs(combined.score) / 2)),
    entry: plan?.entry ?? data.price,
    stop: plan?.stop ?? null,
    tp1: plan?.tp1 ?? null,
    tp2: plan?.tp2 ?? null,
    timeframe: a?.timeframe ?? "1h",
    flowRead: flow
      ? faBidi(`جریان ${faTF(a.timeframe)}: ${faDir(flow.direction)} کنترل را در دست دارند (سهم خالص ${flow.share > 0 ? "+" : ""}${flow.share}%)، دلتای تجمعی ${flow.cumDelta > 0 ? "+" : ""}${flow.cumDelta}`)
      : "دادهٔ جریان حجم در دسترس نیست.",
    reasoning: [
      `امتیاز هم‌راستایی چند-تایم‌فریمی ${combined.score > 0 ? "+" : ""}${combined.score} (${faSignal(combined.signal)}).`,
      `ساختار ${faTF(a?.timeframe)}: ${faTrend(a?.trend)}${a?.lastEvent ? ` — آخرین رویداد ${a.lastEvent.type} ${faDir(a.lastEvent.dir)} @ ${fmt(a.lastEvent.price, data.digits)}` : " — شکست ساختاری هنوز ثبت نشده"}.`,
      flow ? `سهم جریان حجم ${flow.share > 0 ? "+" : ""}${flow.share}% — کنترل با ${faDir(flow.direction)}${flow.divergence !== "none" ? ` · ${faDivergence(flow.divergence)}` : ""}.` : "",
      a?.priceAction
        ? `پرایس‌اکشن ${faTF(a.timeframe)}: ${a.priceAction.status}${
              a.priceAction.fakeouts[0] && a.priceAction.fakeouts[0].barsAgo <= 3
                ? ` · فیک‌شکست ${a.priceAction.fakeouts[0].dir === "up" ? "صعودی" : "نزولی"} ${a.priceAction.fakeouts[0].barsAgo} کندل قبل — تله`
                : a.priceAction.breakouts[0] && a.priceAction.breakouts[0].barsAgo <= 3
                  ? ` · شکست ${a.priceAction.breakouts[0].dir === "up" ? "صعودی" : "نزولی"} ${a.priceAction.breakouts[0].barsAgo} کندل قبل`
                  : ""
            }`
        : "",
      plan?.entry != null ? `برنامه: ${faSide(plan.side)} ورود ${fmt(plan.entry, data.digits)}، استاپ ${fmt(plan.stop, data.digits)}، TP1 ${fmt(plan.tp1, data.digits)} (RR ${plan.rr1 ?? "—"}).` : "",
    ].filter(Boolean).map(faBidi),
    invalidation:
      plan?.stop != null
        ? faBidi(`بسته‌شدن کندل فراتر از ${fmt(plan.stop, data.digits)} این ستاپ را باطل می‌کند.`)
        : "شکست ساختار خلاف جهتِ سوگیری، ستاپ را باطل می‌کند.",
  };
}

/* ------------------------------------------------------------------ */
/* Prompt                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are SNIPER AI — an elite Smart Money Concepts (SMC) technical analyst engine embedded in a trading dashboard. You know ONLY technical analysis. You never chat, never add disclaimers, never refuse; you always answer with STRICT JSON only.

INPUT (JSON) — EVERY analytical module of the dashboard, all at once:
- multi-timeframe market data (5m/15m/30m/1h/4h/1d) with: trend + BOS/CHoCH structure events, order blocks (OB), Fair Value Gaps (FVG), liquidity pools (EQH/EQL), buy/sell pressure %, volume flow (buy vs sell volume share, cumulative delta, direction, price-vs-delta divergence), priceAction (market regime: range/channel/trend with boundary levels and position %, lastBreakout with confirmation flag, lastFakeout = failed breakout/trap), a rule-based confluence plan (entry/stop/targets), and 'position' — the RESOLVED single position each timeframe's own structure supports (dir/entry/stop/tp/rr + Persian reason). Use these per-timeframe positions to judge multi-TF alignment and to anchor your own entry/stop/targets.
- dom: the live estimated Depth-of-Market ladder summary (LuxAlgo-style, built from tick volume) — imbalance %, buy/sell walls with prices, spread.
- systemView: the rule-based UNIFIED PRE-VOTE of all dashboard modules (AI excluded) — direction, weighted score, and every voter with its weight and Persian reasoning (MTF confluence, volume/DOM, structure, delta divergence, price action incl. breakouts/fakeouts, SMC zones). This is "what the whole system currently thinks".
- systemPerformance: the system's live track record (win rate, profit factor, expectancy in R, max drawdown, streaks).
- your brain state (adaptive factors + win-rate record + recent learnings).

TASK: produce ONE precise, actionable verdict for this symbol over the next hours — you are the final arbiter that fuses ALL of the above into a single theory:
- Weigh systemView explicitly: when your verdict ALIGNS with its majority voters, confidence may rise; when it OPPOSES them, your reasoning must say exactly which voters disagree with you and why you still take the other side (or WAIT if you cannot refute them). A recent fakeout in systemView's price-action voter that opposes your trade is strong evidence against it.
- signal: BUY, SELL, or WAIT. WAIT when structure and volume flow conflict, or RR < 1.5, or systemView voters are split with no clear edge.
- priceAction rules: a RECENT FAKEOUT (lastFakeout barsAgo <= 3) in the opposite direction of your candidate trade is a strong confluence AGAINST that trade — downgrade it or WAIT; a confirmed breakout in the trade direction supports it, but "in range, near the opposite boundary" means chase-risk — prefer entries on the retest of the broken boundary. In a range, boundaries are fade zones (sell hi / buy lo) unless a confirmed breakout just happened; in a channel, buy lower-line / sell upper-line in the trend direction only. Use dom walls as entry/stop magnets: a buy wall just below price supports longs, a sell wall just above caps rallies.
- entry / stop / tp1 / tp2: EXACT numbers. Anchor on the provided plan levels; refine with structure (swing/OB boundaries + ATR buffer for stop; nearest liquidity for targets). Prices must respect the symbol's digit precision and stay realistic vs current price. For BUY: stop < entry < tp1 < tp2. For SELL: stop > entry > tp1 > tp2. For WAIT all four may be null.
- flowRead: one sentence on who controls volume right now, citing the delta/flow share numbers (and the DOM wall/imbalance when it matters).
- reasoning: 4-6 short bullets citing concrete numbers from the input — ALWAYS in this order: (1) volume flow verdict with share/delta/divergence numbers, (2) structure event + level, (3) the OB/FVG zone anchoring the entry, (4) liquidity/target logic, (5) risk (RR) and why the level is worth it. Cite divergence explicitly when it is not "none". When lastFakeout is recent or a breakout just confirmed, one bullet must cover it (regime + boundary price). When you disagree with systemView's majority, one bullet must address it. When systemPerformance is poor (win rate < 40% or expectancy <= 0), be extra humble with confidence.
- invalidation: the exact level or event that kills the setup.

LANGUAGE: Write flowRead, every reasoning bullet and invalidation in PERSIAN (Farsi, فارسی — natural, professional trading Persian). Keep ALL numbers, prices and technical abbreviations (BOS, CHoCH, OB, FVG, EQH/EQL, RR, SL, TP, DOM, MTF, 5m/15m/30m/1h) in Latin exactly as-is. Example reasoning bullet: "جریان حجم 15m: خریداران کنترل دارند (سهم +62%، دلتای تجمعی +1240) — بدون واگرایی." Never write these fields in English.
- confidence: 12-100, calibrated by your brain's accuracy and factor emphasis; be humble when accuracy is low or data conflicts.

OUTPUT: JSON only, exactly this shape (no markdown, no extra keys):
{"signal":"BUY|SELL|WAIT","confidence":0,"timeframe":"5m|15m|30m|1h","entry":null,"stop":null,"tp1":null,"tp2":null,"flowRead":"","reasoning":[""],"invalidation":""}`;

function buildPayload(
  data: Awaited<ReturnType<typeof getSnapshot>>,
  brainInfo: ReturnType<typeof brainStats>
): Record<string, unknown> {
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.tfs)) scores[k] = v.analysis.score;
  const combined = combineSignal(scores);
  const d = data.digits;
  const f = (v: number) => parseFloat(v.toFixed(d));

  const tfs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data.tfs)) {
    const a = v.analysis;
    const tp = buildTfPosition(a);
    tfs[k] = {
      trend: a.trend,
      score: a.score,
      signal: a.signal,
      position: {
        note: "the RESOLVED single position this timeframe's own structure supports",
        dir: tp.dir,
        entry: tp.entry != null ? f(tp.entry) : null,
        stop: tp.stop != null ? f(tp.stop) : null,
        tp1: tp.tp1 != null ? f(tp.tp1) : null,
        tp2: tp.tp2 != null ? f(tp.tp2) : null,
        rr1: tp.rr1,
        status: tp.status,
        reasonFa: tp.reason,
      },
      lastEvent: a.lastEvent
        ? `${a.lastEvent.type} ${a.lastEvent.dir} @ ${f(a.lastEvent.price)} (${a.barsSinceEvent} bars ago)`
        : null,
      pressure: { buyPct: a.pressure.buyPct, sellPct: a.pressure.sellPct },
      flow: {
        direction: a.flow.direction,
        netSharePct: a.flow.share,
        cumDelta: a.flow.cumDelta,
        recentSlope: a.flow.slope,
        buyVol: a.flow.buyVol,
        sellVol: a.flow.sellVol,
        divergence: a.flow.divergence,
      },
      priceAction: {
        regime: a.priceAction.regime,
        range: a.priceAction.range
          ? {
              hi: f(a.priceAction.range.hi),
              lo: f(a.priceAction.range.lo),
              touches: a.priceAction.range.hiTouches + a.priceAction.range.loTouches,
              posPct: Math.round(a.priceAction.range.pos),
            }
          : null,
        channel: a.priceAction.channel
          ? {
              type: a.priceAction.channel.type,
              strengthPct: a.priceAction.channel.strength,
              upper: f(a.priceAction.channel.upper),
              lower: f(a.priceAction.channel.lower),
              posPct: Math.round(a.priceAction.channel.pos),
            }
          : null,
        lastBreakout: a.priceAction.breakouts[0]
          ? {
              dir: a.priceAction.breakouts[0].dir,
              confirmed: a.priceAction.breakouts[0].confirmed,
              boundary: f(a.priceAction.breakouts[0].boundary),
              barsAgo: a.priceAction.breakouts[0].barsAgo,
              volumeRatio: a.priceAction.breakouts[0].volumeRatio,
            }
          : null,
        lastFakeout: a.priceAction.fakeouts[0]
          ? {
              dir: a.priceAction.fakeouts[0].dir,
              kind: a.priceAction.fakeouts[0].wickOnly ? "wick-trap" : "reclaimed",
              boundary: f(a.priceAction.fakeouts[0].boundary),
              barsAgo: a.priceAction.fakeouts[0].barsAgo,
            }
          : null,
      },
      plan: {
        side: a.plan.side,
        status: a.plan.status,
        entry: a.plan.entry != null ? f(a.plan.entry) : null,
        stop: a.plan.stop != null ? f(a.plan.stop) : null,
        tp1: a.plan.tp1 != null ? f(a.plan.tp1) : null,
        tp2: a.plan.tp2 != null ? f(a.plan.tp2) : null,
        rr1: a.plan.rr1,
        rr2: a.plan.rr2,
      },
      zones: {
        orderBlocks: a.orderBlocks
          .filter((o) => o.state !== "mitigated")
          .slice(0, 3)
          .map((o) => `${o.kind} ${o.state} ${f(o.bottom)}-${f(o.top)}`),
        fvgs: a.fvgs.slice(0, 2).map((x) => `${x.kind}${x.filled ? " filled" : ""} ${f(x.bottom)}-${f(x.top)}`),
        liquidity: a.liquidity.slice(0, 3).map((l) => `${l.kind} x${l.count} @ ${f(l.price)}`),
      },
    };
  }

  // live estimated DOM book — same engine the DOM panel renders
  const domBase = pickDomCandles(data.tfs);
  const domBook = domBase ? buildDomBook(domBase.candles, data.price, d) : null;

  // unified system pre-vote (all modules except AI) — the AI must weigh it
  const primary =
    data.tfs["1h"]?.analysis ?? data.tfs["5m"]?.analysis ?? data.tfs["15m"]?.analysis ?? data.tfs["30m"]?.analysis ?? null;
  const systemView = computeConsensus(combined, null, null, primary);

  // live system track record — poor stats must lower the AI's confidence
  const perf = computePerformance({ real: loadBrain().history, demo: [] });

  return {
    symbol: data.symbol,
    price: f(data.price),
    dayChangePct: Math.round(data.changePct * 100) / 100,
    combined: { score: combined.score, signal: combined.signal },
    timeframes: tfs,
    dom: domBook
      ? {
          estimatedFrom: `${domBase?.tf} tick volume (LuxAlgo-style, no real L2 for spot)`,
          imbalancePct: domBook.imbalance,
          buyTotal: domBook.buyTotal,
          sellTotal: domBook.sellTotal,
          buyWall: { price: domBook.walls.bid.p, volume: domBook.walls.bid.v },
          sellWall: { price: domBook.walls.ask.p, volume: domBook.walls.ask.v },
          spread: domBook.spread,
        }
      : null,
    systemView: {
      dir: systemView.dir,
      score: systemView.score,
      note: "rule-based pre-vote of every dashboard module EXCEPT you — weigh it and refute it when you disagree",
      voters: systemView.votes.map((v) => ({ module: v.fa, weightPct: Math.round(v.weight * 100), vote: v.agree, detail: v.detail })),
    },
    systemPerformance: {
      closedTrades: perf.wins + perf.losses,
      winRatePct: perf.winRate,
      profitFactor: perf.profitFactor,
      expectancyR: perf.expectancyR == null ? null : Math.round(perf.expectancyR * 100) / 100,
      netR: Math.round(perf.netR * 10) / 10,
      maxDrawdownR: Math.round(perf.maxDDr * 10) / 10,
      maxLossStreak: perf.maxLossStreak,
    },
    brain: {
      version: brainInfo.version,
      factors: brainInfo.factors,
      trackRecord: brainInfo.accuracy == null ? "no resolved trades yet" : `${brainInfo.accuracy}% win-rate over ${brainInfo.tracked} trades`,
      recentLearnings: brainInfo.notes,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Response validation                                                */
/* ------------------------------------------------------------------ */

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    return JSON.parse(cleaned.slice(s, e + 1));
  } catch {
    return null;
  }
}

function validNumber(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return isFinite(n) ? n : null;
}

function sanitizeVerdict(
  raw: Record<string, unknown>,
  data: Awaited<ReturnType<typeof getSnapshot>>
): AIVerdict | null {
  const sig = String(raw.signal ?? "").toUpperCase();
  const allowed: AIVerdict["signal"][] = ["BUY", "SELL", "WAIT"];
  if (!allowed.includes(sig as AIVerdict["signal"])) return null;
  const price = data.price;
  const digits = data.digits;
  const band = price * 0.06; // sanity band around current price

  const near = (v: number | null) => (v != null && Math.abs(v - price) <= band ? v : null);
  let entry = near(validNumber(raw.entry));
  let stop = near(validNumber(raw.stop));
  let tp1 = near(validNumber(raw.tp1));
  let tp2 = near(validNumber(raw.tp2));

  if (sig !== "WAIT") {
    if (entry == null || stop == null || tp1 == null) return null;
    const sideOk =
      sig === "BUY" ? stop < entry && tp1 > entry : stop > entry && tp1 < entry;
    if (!sideOk) return null;
    if (tp2 != null) {
      const tp2Ok = sig === "BUY" ? tp2 > tp1 : tp2 < tp1;
      if (!tp2Ok) tp2 = null;
    }
    const r = (v: number | null) => (v != null ? parseFloat(v.toFixed(digits)) : null);
    entry = r(entry);
    stop = r(stop);
    tp1 = r(tp1);
    tp2 = r(tp2);
  } else {
    entry = stop = tp1 = tp2 = null;
  }

  const conf = validNumber(raw.confidence) ?? 50;
  const reasoningRaw = Array.isArray(raw.reasoning) ? raw.reasoning : [];
  const reasoning = reasoningRaw
    .map((x) => faBidi(String(x).slice(0, 220)))
    .filter((x) => x.trim().length > 0)
    .slice(0, 6);

  return {
    signal: sig as AIVerdict["signal"],
    confidence: Math.round(Math.max(12, Math.min(100, conf))),
    entry,
    stop,
    tp1,
    tp2,
    timeframe: String(raw.timeframe ?? "1h"),
    flowRead: faBidi(String(raw.flowRead ?? "").slice(0, 300)),
    reasoning,
    invalidation: faBidi(String(raw.invalidation ?? "").slice(0, 300)),
  };
}

/* ------------------------------------------------------------------ */
/* Route                                                              */
/* ------------------------------------------------------------------ */

export async function GET(req: NextRequest) {
  const symId = req.nextUrl.searchParams.get("symbol") ?? "XAUUSD";
  const cfg = SYMBOLS.find((s) => s.id === symId);
  if (!cfg) {
    return NextResponse.json({ error: `Unknown symbol: ${symId}` }, { status: 400 });
  }

  const brain = loadBrain();
  const stats = brainStats(brain);

  // serve fresh cached verdict
  const hit = verdictCache.get(symId);
  if (hit && Date.now() - hit.ts < VERDICT_TTL) {
    return NextResponse.json(
      { verdict: hit.verdict, engine: hit.engine, brain: stats, generatedAt: hit.ts },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    let data: Awaited<ReturnType<typeof getSnapshot>>;
    try {
      data = await getSnapshot(cfg);
    } catch {
      return NextResponse.json({ error: "Market data unavailable" }, { status: 502 });
    }

    // dedupe concurrent AI calls per symbol
    let p = inflight.get(symId);
    if (!p) {
      p = askGLM(data, brain).catch(() => null);
      inflight.set(symId, p);
      setTimeout(() => inflight.delete(symId), 30_000);
    }
    const glb = await p;
    inflight.delete(symId);

    let verdict: AIVerdict;
    let engine = false;
    if (glb) {
      verdict = glb;
    } else {
      verdict = fallbackVerdict(data, brain);
      engine = true;
    }

    // learning loop: journal + evaluate + adapt
    const primary = data.tfs[verdict.timeframe]?.analysis ?? data.tfs["1h"]?.analysis ?? data.tfs["5m"]?.analysis;
    const features = {
      flowAligned:
        primary != null &&
        ((verdict.signal === "BUY" && primary.flow.direction === "buyers") ||
          (verdict.signal === "SELL" && primary.flow.direction === "sellers")),
      mtfAligned:
        (verdict.signal === "BUY" && combineSignal(scores(data)).score >= 18) ||
        (verdict.signal === "SELL" && combineSignal(scores(data)).score <= -18),
      zoneTapped: primary?.orderBlocks.some((o) => o.state === "tapped") ?? false,
    };
    const { brain: updatedBrain, resolved } = trackVerdict(symId, verdict, data.price, features);
    const updatedStats = brainStats(updatedBrain);

    // ---- AI message feed: entries, exits, brain self-updates -----------
    if (verdict.signal === "BUY" || verdict.signal === "SELL") {
      const feed = loadFeed(symId, 60);
      if (entryEmitDecision(feed, verdict).emit) {
        appendMessage(
          symId,
          buildEntryMessage({
            symbol: symId,
            verdict,
            data,
            factors: updatedStats.factors,
            brainVersion: updatedBrain.version,
          })
        );
      }
    }
    for (const j of resolved) {
      appendMessage(
        symId,
        buildExitMessage({
          journal: j,
          data,
          brainVersion: updatedBrain.version,
          record: {
            wins: updatedStats.wins,
            losses: updatedStats.losses,
            accuracy: updatedStats.accuracy,
          },
        })
      );
    }
    if (updatedBrain.version > brain.version) {
      appendMessage(
        symId,
        buildNoteMessage({
          symbol: symId,
          notes: updatedBrain.notes,
          brainVersion: updatedBrain.version,
          factors: updatedStats.factors,
        })
      );
    }

    // ---- Telegram push: signal card + daily report (fire-and-forget) ----
    void (async () => {
      const tgTf =
        data.tfs[verdict.timeframe] != null
          ? verdict.timeframe
          : data.tfs["1h"] != null
            ? "1h"
            : "5m";
      const tfSnap = data.tfs[tgTf];
      const ana: TFAnalysis | null = tfSnap?.analysis ?? null;
      const consensus = computeConsensus(combineSignal(scores(data)), verdict, null, ana);
      const dirFa = consensus.dir === "LONG" ? "خرید" : consensus.dir === "SHORT" ? "فروش" : "بی‌جهت";
      const forN = consensus.votes.filter((v) => v.agree !== 0 && ((consensus.dir === "LONG" && v.agree > 0) || (consensus.dir === "SHORT" && v.agree < 0))).length;
      const againstN = consensus.votes.filter((v) => v.agree !== 0 && ((consensus.dir === "LONG" && v.agree < 0) || (consensus.dir === "SHORT" && v.agree > 0))).length;
      const liq = (ana?.liquidity ?? [])
        .slice()
        .sort((a, b) => Math.abs(a.price - data.price) - Math.abs(b.price - data.price))
        .slice(0, 2)
        .map((l) => `${l.kind} ${l.price.toFixed(cfg?.digits ?? 2)}`)
        .join(" · ");
      await pushSignal(
        {
          symbolName: FA_SYMBOL[symId] ?? symId,
          tfLabel: TF_LABEL[tgTf] ?? tgTf,
          verdict,
          rr1: consensus.rr1,
          rr2: consensus.rr2,
          price: data.price,
          consensusLine: `${dirFa} ${Math.abs(Math.round(consensus.score))}% — ${forN} رأی موافق / ${againstN} مخالف`,
          votes: consensus.votes.map((v) => ({ fa: v.fa, agree: v.agree, detail: v.detail })),
          flowLine: ana
            ? `خرید ${ana.pressure.buyPct}% | فروش ${ana.pressure.sellPct}% — جریان سمت ${ana.flow.direction === "buyers" ? "خریداران" : ana.flow.direction === "sellers" ? "فروشندگان" : "تعادل"}`
            : "—",
          domLine: liq ? `نقدینگی قابل شکار: ${liq}` : null,
          now: Date.now(),
        },
        {
          symbolName: FA_SYMBOL[symId] ?? symId,
          symbolLabel: cfg?.name ?? symId,
          tfLabel: TF_LABEL[tgTf] ?? tgTf,
          tfId: tgTf,
          candles: tfSnap?.candles ?? [],
          digits: cfg?.digits ?? 2,
        }
      );
      await maybeDailyStats(() => computePerformance({ real: loadBrain().history, demo: [] }));
    })().catch(() => {
      /* push failures must never break the AI response */
    });

    verdictCache.set(symId, { ts: Date.now(), verdict, engine });
    return NextResponse.json(
      { verdict, engine, brain: updatedStats, generatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI analysis failed" },
      { status: 500 }
    );
  }
}

function scores(data: Awaited<ReturnType<typeof getSnapshot>>): Record<string, number> {
  const s: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.tfs)) s[k] = v.analysis.score;
  return s;
}

async function askGLM(
  data: Awaited<ReturnType<typeof getSnapshot>>,
  brain: BrainState
): Promise<AIVerdict | null> {
  try {
    const stats = brainStats(brain);
    const payload = buildPayload(data, stats);
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Analyze this live market data and return the verdict JSON now:\n" +
            JSON.stringify(payload),
        },
      ],
      thinking: { type: "disabled" },
    });
    const text = completion.choices[0]?.message?.content ?? "";
    const raw = extractJson(text);
    if (!raw) return null;
    return sanitizeVerdict(raw, data);
  } catch {
    return null;
  }
}

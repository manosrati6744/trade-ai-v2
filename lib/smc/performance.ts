/**
 * Performance analytics — international-standard trading statistics
 * computed from the AI brain's virtual journal (+ optional clearly-labelled
 * demo data kept in a separate file so the learning brain is never touched).
 *
 * Risk metrics follow the convention used by Myfxbook / TradingView strategy
 * reports: R-multiples (pnl ÷ initial risk), profit factor, expectancy,
 * max drawdown on the equity curve, and per-period (day/month/year) P&L.
 */

import type { JournalEntry } from "@/lib/ai/brain";

export interface PerfTrade {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  exit: number | null;
  outcome: "win" | "loss" | "superseded" | "expired" | "open";
  confidence: number;
  tOpen: number;
  tClosed: number | null;
  pnl: number; // price points — positive = profit
  r: number; // R multiple = pnl / |entry - stop|
  demo: boolean;
}

export interface Bucket {
  key: string; // 2026-11-01 / 2026-11 / 2026
  label: string; // «۱۵ نوامبر» / «نوامبر ۲۰۲۶» / «۲۰۲۶»
  trades: number;
  wins: number;
  losses: number;
  pnl: number; // price points
  r: number; // net R
}

export interface SideStats {
  n: number;
  wins: number;
  losses: number;
  r: number;
  pnl: number;
  winRate: number | null;
}

export interface PerfStats {
  generatedAt: number;
  demoActive: boolean;
  totalTracked: number;
  open: number;
  closed: number; // win + loss + superseded + expired
  wins: number;
  losses: number;
  winRate: number | null; // % on decided (win/loss) trades
  netPnl: number; // price points
  netR: number;
  grossProfitR: number;
  grossLossR: number;
  profitFactor: number | null;
  expectancyR: number | null; // avg R per closed trade
  avgWinR: number | null;
  avgLossR: number | null;
  bestR: number | null;
  worstR: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  maxDDr: number; // max drawdown (positive number, in R)
  recoveryFactor: number | null; // netR / maxDDr
  avgHoldMin: number | null;
  longs: SideStats;
  shorts: SideStats;
  equity: { i: number; t: number; cumR: number; label: string }[];
  daily: Bucket[]; // last 14 calendar days, zero-filled
  monthly: Bucket[]; // last 12 calendar months, zero-filled
  yearly: Bucket[]; // all years with data
  today: Bucket | null;
  mtd: Bucket | null;
  ytd: Bucket | null;
  worstDay: Bucket | null;
  worstMonth: Bucket | null;
  worstYear: Bucket | null;
  recent: PerfTrade[]; // last 10 closed, newest first
}

const CLOSED: PerfTrade["outcome"][] = ["win", "loss", "superseded", "expired"];

const FA_MONTHS = [
  "ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن",
  "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر",
];

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const fa = (s: string | number) => String(s).replace(/\d/g, (d) => FA_DIGITS[+d]);

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, trades: 0, wins: 0, losses: 0, pnl: 0, r: 0 };
}

/** Journal row → performance trade with realized pnl + R. */
export function entryToTrade(e: JournalEntry, demo = false): PerfTrade {
  const risk = Math.abs(e.entry - e.stop);
  let pnl = 0;
  if (e.outcome === "win") pnl = e.side === "LONG" ? e.tp1 - e.entry : e.entry - e.tp1;
  else if (e.outcome === "loss") pnl = e.side === "LONG" ? e.stop - e.entry : e.entry - e.stop;
  else if (CLOSED.includes(e.outcome) && e.exitPrice != null) {
    pnl = e.side === "LONG" ? e.exitPrice - e.entry : e.entry - e.exitPrice;
  }
  return {
    id: e.id,
    symbol: e.symbol,
    side: e.side,
    entry: e.entry,
    stop: e.stop,
    tp1: e.tp1,
    exit: e.exitPrice ?? null,
    outcome: e.outcome,
    confidence: e.confidence,
    tOpen: e.tOpen,
    tClosed: e.tClosed ?? null,
    pnl,
    r: risk > 0 ? pnl / risk : 0,
    demo,
  };
}

function fillBucket(b: Bucket, t: PerfTrade, res: "win" | "loss" | "closed") {
  b.trades++;
  b.pnl += t.pnl;
  b.r += t.r;
  if (res === "win") b.wins++;
  else if (res === "loss") b.losses++;
}

function resOf(t: PerfTrade): "win" | "loss" | "closed" {
  if (t.outcome === "win") return "win";
  if (t.outcome === "loss") return "loss";
  return "closed";
}

function computeCore(trades: PerfTrade[], demoActive: boolean, now: number): PerfStats {
  const decided = trades.filter((t) => t.outcome === "win" || t.outcome === "loss");
  const closed = trades.filter((t) => CLOSED.includes(t.outcome));
  const wins = decided.filter((t) => t.outcome === "win");
  const losses = decided.filter((t) => t.outcome === "loss");
  const winRate = decided.length ? (wins.length / decided.length) * 100 : null;

  const netPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const netR = closed.reduce((s, t) => s + t.r, 0);
  const grossProfitR = closed.filter((t) => t.r > 0).reduce((s, t) => s + t.r, 0);
  const grossLossR = Math.abs(closed.filter((t) => t.r < 0).reduce((s, t) => s + t.r, 0));
  const avgWinR = wins.length ? wins.reduce((s, t) => s + t.r, 0) / wins.length : null;
  const avgLossR = losses.length
    ? Math.abs(losses.reduce((s, t) => s + t.r, 0) / losses.length)
    : null;

  // streaks + best/worst over decided trades in close order
  const ordered = [...decided].sort((a, b) => (a.tClosed ?? 0) - (b.tClosed ?? 0));
  let maxWinStreak = 0, maxLossStreak = 0, curW = 0, curL = 0;
  for (const t of ordered) {
    if (t.outcome === "win") { curW++; curL = 0; }
    else { curL++; curW = 0; }
    maxWinStreak = Math.max(maxWinStreak, curW);
    maxLossStreak = Math.max(maxLossStreak, curL);
  }
  const rs = decided.map((t) => t.r);
  const bestR = rs.length ? Math.max(...rs) : null;
  const worstR = rs.length ? Math.min(...rs) : null;

  // equity curve (closed trades) + max drawdown in R
  const eqOrdered = [...closed].sort((a, b) => (a.tClosed ?? 0) - (b.tClosed ?? 0));
  const equity: PerfStats["equity"] = [];
  let cum = 0, peak = 0, maxDDr = 0;
  for (const t of eqOrdered) {
    cum += t.r;
    peak = Math.max(peak, cum);
    maxDDr = Math.max(maxDDr, peak - cum);
    const d = t.tClosed ? new Date(t.tClosed) : null;
    equity.push({
      i: equity.length + 1,
      t: t.tClosed ?? 0,
      cumR: +cum.toFixed(3),
      label: d ? `${fa(d.getDate())} ${FA_MONTHS[d.getMonth()]}` : "—",
    });
  }

  const holds = closed
    .filter((t) => t.tClosed != null)
    .map((t) => ((t.tClosed as number) - t.tOpen) / 60_000);
  const avgHoldMin = holds.length ? holds.reduce((s, x) => s + x, 0) / holds.length : null;

  const side = (s: "LONG" | "SHORT"): SideStats => {
    const rows = closed.filter((t) => t.side === s);
    const w = rows.filter((t) => t.outcome === "win").length;
    const l = rows.filter((t) => t.outcome === "loss").length;
    return {
      n: rows.length,
      wins: w,
      losses: l,
      r: rows.reduce((acc, t) => acc + t.r, 0),
      pnl: rows.reduce((acc, t) => acc + t.pnl, 0),
      winRate: w + l ? (w / (w + l)) * 100 : null,
    };
  };

  // period buckets (server local time)
  const daily = new Map<string, Bucket>();
  const monthly = new Map<string, Bucket>();
  const yearly = new Map<string, Bucket>();
  for (const t of closed) {
    if (!t.tClosed) continue;
    const d = new Date(t.tClosed);
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const mk = dk.slice(0, 7);
    const yk = String(d.getFullYear());
    if (!daily.has(dk)) daily.set(dk, emptyBucket(dk, `${fa(d.getDate())} ${FA_MONTHS[d.getMonth()]}`));
    if (!monthly.has(mk)) monthly.set(mk, emptyBucket(mk, `${FA_MONTHS[d.getMonth()]} ${fa(d.getFullYear())}`));
    if (!yearly.has(yk)) yearly.set(yk, emptyBucket(yk, fa(yk)));
    const res = resOf(t);
    fillBucket(daily.get(dk)!, t, res);
    fillBucket(monthly.get(mk)!, t, res);
    fillBucket(yearly.get(yk)!, t, res);
  }

  // zero-filled windows for charts
  const dailyArr: Bucket[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dailyArr.push(daily.get(k) ?? emptyBucket(k, `${fa(d.getDate())} ${FA_MONTHS[d.getMonth()]}`));
  }
  const monthlyArr: Bucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyArr.push(monthly.get(k) ?? emptyBucket(k, `${FA_MONTHS[d.getMonth()]} ${fa(d.getFullYear())}`));
  }
  const yearlyArr = [...yearly.values()].sort((a, b) => a.key.localeCompare(b.key));

  const today = dailyArr[dailyArr.length - 1] ?? null;
  const mKey = monthlyArr[monthlyArr.length - 1]?.key ?? "";
  const mtd = monthly.get(mKey) ?? null;
  const yKey = String(new Date(now).getFullYear());
  const ytd = yearly.get(yKey) ?? null;
  const worstOf = (arr: Bucket[], field: "pnl" | "r"): Bucket | null => {
    const withData = arr.filter((b) => b.trades > 0);
    if (!withData.length) return null;
    return withData.reduce((w, b) => (b[field] < w[field] ? b : w), withData[0]);
  };

  return {
    generatedAt: now,
    demoActive,
    totalTracked: trades.length,
    open: trades.filter((t) => t.outcome === "open").length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    netPnl,
    netR,
    grossProfitR,
    grossLossR,
    profitFactor: grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR > 0 ? Infinity : null,
    expectancyR: closed.length ? netR / closed.length : null,
    avgWinR,
    avgLossR,
    bestR,
    worstR,
    maxWinStreak,
    maxLossStreak,
    maxDDr,
    recoveryFactor: maxDDr > 0 ? netR / maxDDr : null,
    avgHoldMin,
    longs: side("LONG"),
    shorts: side("SHORT"),
    equity,
    daily: dailyArr,
    monthly: monthlyArr,
    yearly: yearlyArr,
    today,
    mtd,
    ytd,
    worstDay: worstOf(dailyArr, "pnl"),
    worstMonth: worstOf(monthlyArr, "pnl"),
    worstYear: worstOf(yearlyArr, "pnl"),
    recent: [...closed].sort((a, b) => (b.tClosed ?? 0) - (a.tClosed ?? 0)).slice(0, 10),
  };
}

export function computePerformance(
  entries: { real: JournalEntry[]; demo: JournalEntry[] },
  now = Date.now()
): PerfStats {
  const trades = [
    ...entries.real.map((e) => entryToTrade(e, false)),
    ...entries.demo.map((e) => entryToTrade(e, true)),
  ];
  return computeCore(trades, entries.demo.length > 0, now);
}

/* ------------------------------------------------------------------ */
/* Demo dataset — clearly labelled, separate file, never feeds the AI. */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDemoEntries(now = Date.now()): JournalEntry[] {
  const rnd = mulberry32(20261101);
  const out: JournalEntry[] = [];
  const n = 76;
  for (let i = 0; i < n; i++) {
    const side: "LONG" | "SHORT" = rnd() < 0.52 ? "LONG" : "SHORT";
    // realistic SMC-style distribution: 58% winners, avg win 1.55R, loss -1R
    const win = rnd() < 0.58;
    const rMult = win ? 1 + rnd() * 1.4 : -(0.85 + rnd() * 0.3);
    const entry = 3850 + rnd() * 120;
    const risk = 4 + rnd() * 6;
    const stop = side === "LONG" ? entry - risk : entry + risk;
    const tp1 = side === "LONG" ? entry + risk * 1.5 : entry - risk * 1.5;
    const exit = side === "LONG" ? entry + risk * rMult : entry - risk * rMult;
    const tClosed = now - Math.floor((1 - i / n) * 88 * 86_400_000) - Math.floor(rnd() * 6 * 3600_000);
    out.push({
      id: `demo-${i}-${tClosed}`,
      symbol: "XAUUSD",
      signal: side === "LONG" ? "BUY" : "SELL",
      side,
      entry: +entry.toFixed(2),
      stop: +stop.toFixed(2),
      tp1: +tp1.toFixed(2),
      confidence: 55 + Math.floor(rnd() * 35),
      features: { flowAligned: rnd() < 0.6, mtfAligned: rnd() < 0.5, zoneTapped: rnd() < 0.5 },
      tOpen: tClosed - (20 + Math.floor(rnd() * 160)) * 60_000,
      tClosed,
      exitPrice: +exit.toFixed(2),
      outcome: win ? "win" : "loss",
    });
  }
  return out;
}

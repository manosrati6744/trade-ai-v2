/**
 * AI message journal — the AI's persistent "chat" with the user.
 *
 * Every time SNIPER AI issues an entry signal, closes (or supersedes) a
 * virtual position, or upgrades its own brain, a message is appended here.
 * Entry/exit messages carry a compact annotated-chart payload so the UI can
 * DRAW the decision — the user studies exactly why the AI acted.
 *
 * Stored at data/ai-messages.json, newest first per symbol, capped.
 */

import fs from "fs";
import path from "path";
import { flowSeries, combineSignal, type Candle, type TFAnalysis } from "@/lib/smc/engine";
import type { SnapshotData } from "@/lib/smc/snapshot";
import type { AIVerdict, BrainFactors, JournalEntry } from "@/lib/ai/brain";
import type { AIMessage, MessageChart } from "@/lib/ai/types";
import { faBidi, faDivergence, faDir, faSignal, faTF, faTrend } from "@/lib/ai/fa";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const MSG_FILE = path.join(DATA_DIR, "ai-messages.json");
const MAX_PER_SYMBOL = 60;
const CHART_BARS = 56;

/** Same-signal re-anchor: entry must move at least this far (0.12%). */
const REANCHOR_PCT = 0.0012;
/** Minimum gap between two entry messages for the same signal. */
const REANCHOR_GAP_MS = 150_000;

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

type MsgStore = Record<string, AIMessage[]>;

function loadStore(): MsgStore {
  try {
    if (!fs.existsSync(MSG_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(MSG_FILE, "utf8")) as MsgStore;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveStore(s: MsgStore): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = MSG_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, MSG_FILE);
  } catch {
    /* storage unavailable — feed lives in-memory this session */
  }
}

export function loadFeed(symbol: string, limit = 14): AIMessage[] {
  const list = loadStore()[symbol] ?? [];
  return list.slice(0, limit);
}

export function appendMessage(symbol: string, msg: AIMessage): void {
  const store = loadStore();
  const list = store[symbol] ?? [];
  list.unshift(msg);
  store[symbol] = list.slice(0, MAX_PER_SYMBOL);
  saveStore(store);
}

/* ------------------------------------------------------------------ */
/* Dedup / throttle                                                    */
/* ------------------------------------------------------------------ */

export function entryEmitDecision(feed: AIMessage[], v: AIVerdict): { emit: boolean } {
  const last = feed.find((m) => m.kind === "entry");
  if (!last) return { emit: true };
  if (last.signal !== v.signal) return { emit: true };
  const moved =
    v.entry != null && last.entry != null ? Math.abs(v.entry - last.entry) / last.entry : 0;
  if (moved > REANCHOR_PCT && Date.now() - last.t > REANCHOR_GAP_MS) return { emit: true };
  return { emit: false };
}

/* ------------------------------------------------------------------ */
/* Chart payload builder                                               */
/* ------------------------------------------------------------------ */

export function buildChartPayload(
  a: TFAnalysis,
  candles: Candle[],
  digits: number,
  levels: {
    entry?: number | null;
    stop?: number | null;
    tp1?: number | null;
    tp2?: number | null;
    exit?: number | null;
    entryK?: number | null;
  } = {}
): MessageChart {
  const vis: Candle[] = candles.slice(-CHART_BARS);
  const offset = candles.length - vis.length;
  // analysis indices are relative to the full analyzed window — shift them
  const idxShift = a.indexOffset || 0;
  const flows = flowSeries(vis, vis.length);
  const r = (v: number) => parseFloat(v.toFixed(digits));

  const events = a.events
    .filter((e) => e.i - idxShift - offset >= 0)
    .slice(-3)
    .map((e) => ({ k: e.i - idxShift - offset, price: r(e.price), type: e.type, dir: e.dir }));

  const obs = a.orderBlocks
    .filter((o) => o.state !== "mitigated" && o.i - idxShift - offset >= 0)
    .slice(-3)
    .map((o) => ({ kind: o.kind, top: r(o.top), bottom: r(o.bottom), k: o.i - idxShift - offset }));

  const zone = a.plan.entryZone;

  return {
    timeframe: a.timeframe,
    bars: vis.map((c) => ({ t: c.t, o: r(c.o), h: r(c.h), l: r(c.l), c: r(c.c) })),
    flow: flows.map((f) => ({ buy: Math.round(f.buy), sell: Math.round(f.sell) })),
    marks: {
      entry: levels.entry ?? a.plan.entry,
      stop: levels.stop ?? a.plan.stop,
      tp1: levels.tp1 ?? a.plan.tp1,
      tp2: levels.tp2 ?? a.plan.tp2,
      zone: zone ? [r(zone[0]), r(zone[1])] : null,
      zoneKind: a.plan.side === "SHORT" ? "supply" : a.plan.side === "LONG" ? "demand" : null,
      exit: levels.exit ?? null,
      entryK: levels.entryK ?? null,
      events,
      obs,
      trend: a.trend,
      divergence: a.flow.divergence,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Message builders                                                    */
/* ------------------------------------------------------------------ */

function pickTF(data: SnapshotData, wanted: string): { tf: string; a: TFAnalysis; candles: Candle[] } | null {
  const order = [wanted, "1h", "30m", "15m", "4h", "5m", "1d"];
  for (const tf of order) {
    const snap = data.tfs[tf];
    if (snap) return { tf, a: snap.analysis, candles: snap.candles };
  }
  return null;
}

export function buildEntryMessage(params: {
  symbol: string;
  verdict: AIVerdict;
  data: SnapshotData;
  factors: BrainFactors;
  brainVersion: number;
}): AIMessage {
  const { symbol, verdict, data, factors, brainVersion } = params;
  const pick = pickTF(data, verdict.timeframe);
  const a = pick?.a;
  const d = data.digits;
  const f = (v: number | null | undefined) =>
    v == null || !isFinite(v) ? "—" : v.toFixed(d);

  // reasoning chain: deterministic context first, then the model's own bullets
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(data.tfs)) scores[k] = v.analysis.score;
  const combined = combineSignal(scores);
  const reasoning: string[] = [];
  reasoning.push(
    `هم‌راستایی چند-تایم‌فریمی ${combined.score > 0 ? "+" : ""}${combined.score}/100 (${faSignal(combined.signal)}) — وزن‌دهی 5m/15m/30m/1h/4h/1d.`
  );
  if (a) {
    reasoning.push(
      `ساختار ${faTF(pick!.tf)}: ${faTrend(a.trend)}${a.lastEvent ? ` — آخرین رویداد ${a.lastEvent.type} ${faDir(a.lastEvent.dir)} @ ${f(a.lastEvent.price)} (${a.barsSinceEvent} کندل پیش)` : " — شکست ساختاری هنوز ثبت نشده"}.`
    );
    if (a.flow.divergence !== "none") {
      reasoning.push(
        a.flow.divergence === "bullish"
          ? `واگرایی حجمی (صعودی): قیمت کفِ پایین‌تر زد اما دلتای تجمعی کفِ بالاتر ساخت — فروشندگان در حال جذب‌شدن‌اند.`
          : `واگرایی حجمی (نزولی): قیمت سقفِ بالاتر زد اما دلتای تجمعی سقفِ پایین‌تر ساخت — خریداران به اشباع رسیده‌اند.`
      );
    }
    if (a.plan.entryZone) {
      reasoning.push(
        `تصمیم روی ناحیهٔ ${a.plan.side === "SHORT" ? "عرضه" : "تقاضا"} ${f(a.plan.entryZone[0])}–${f(a.plan.entryZone[1])} سوار است (${a.plan.status === "in-zone" ? "قیمت همین حالا داخل ناحیه است" : "در انتظار بازگشت قیمت به ناحیه"}).`
      );
    }
  }
  reasoning.push(...verdict.reasoning);

  const chart = a && pick ? buildChartPayload(a, pick.candles, d, { ...verdict }) : null;

  return {
    id: `${symbol}-entry-${Date.now()}`,
    symbol,
    t: Date.now(),
    kind: "entry",
    signal: verdict.signal,
    confidence: verdict.confidence,
    timeframe: verdict.timeframe,
    entry: verdict.entry,
    stop: verdict.stop,
    tp1: verdict.tp1,
    tp2: verdict.tp2,
    flowRead: faBidi(verdict.flowRead),
    reasoning: reasoning.map(faBidi),
    invalidation: faBidi(verdict.invalidation),
    factors,
    brainVersion,
    chart,
  };
}

function pnlOf(j: JournalEntry): number {
  const exit = j.exitPrice ?? j.entry;
  const raw = j.side === "LONG" ? ((exit - j.entry) / j.entry) * 100 : ((j.entry - exit) / j.entry) * 100;
  return Math.round(raw * 100) / 100;
}

function heldOf(j: JournalEntry): number {
  return Math.max(0, (j.tClosed ?? Date.now()) - j.tOpen);
}

export function buildExitMessage(params: {
  journal: JournalEntry;
  data: SnapshotData;
  brainVersion: number;
  record: { wins: number; losses: number; accuracy: number | null };
}): AIMessage {
  const { journal: j, data, brainVersion, record } = params;
  const pick = pickTF(data, "1h") ?? pickTF(data, "5m");
  const d = data.digits;
  const f = (v: number | null | undefined) =>
    v == null || !isFinite(v) ? "—" : v.toFixed(d);
  const pnl = pnlOf(j);
  const heldMin = Math.round(heldOf(j) / 60_000);
  const held = heldMin >= 90 ? `${Math.floor(heldMin / 60)} ساعت و ${heldMin % 60} دقیقه` : `${heldMin} دقیقه`;

  const reasoning: string[] = [];
  reasoning.push(
    `مدیریت پوزیشن ${j.side === "LONG" ? "خرید (LONG)" : "فروش (SHORT)"} خود از ${f(j.entry)}: ${j.outcome === "win" ? `هدف ${f(j.tp1)} برخورد کرد` : j.outcome === "loss" ? `استاپ محافظ ${f(j.stop)} فعال شد` : j.outcome === "expired" ? "افق زمانی سشن (۸ ساعت) بدون تصمیم به پایان رسید" : "یک سیگنال تازه‌تر و باکیفیت‌تر جایگزین این پوزیشن شد"}.`
  );
  reasoning.push(`بسته‌شدن در ${f(j.exitPrice ?? data.price)} — نتیجهٔ محقق‌شده ${pnl > 0 ? "+" : ""}${pnl}% در ${held}.`);
  if (pick) {
    const flow = pick.a.flow;
    reasoning.push(
      `جریان در لحظهٔ خروج: ${faDir(flow.direction)} کنترل دارد (خالص ${flow.share > 0 ? "+" : ""}${flow.share}%، ΣΔ ${flow.cumDelta > 0 ? "+" : ""}${flow.cumDelta.toLocaleString("en-US")})${flow.divergence !== "none" ? ` · ${faDivergence(flow.divergence)}` : ""}.`
    );
  }
  reasoning.push(
    record.accuracy == null
      ? `رکورد مغز: پیش از این، معاملهٔ قابل‌ارزیابی‌ای وجود نداشت.`
      : `رکورد مغز: ${record.wins} برد / ${record.losses} باخت (نرخ برد ${record.accuracy}٪) — وزن‌ها هر ۱۰ معاملهٔ بسته‌شده تنظیم می‌شوند.`
  );

  // locate the entry bar inside the visible window (for the drawing)
  let entryK: number | null = null;
  if (pick) {
    const vis = pick.candles.slice(-CHART_BARS);
    const idx = vis.findIndex((c) => c.t * 1000 >= j.tOpen);
    if (idx >= 0) {
      entryK = idx;
    } else if (vis.length) {
      // tOpen inside the current forming bar (or data ends before it)
      entryK = vis[vis.length - 1].t * 1000 + 3_600_000 > j.tOpen ? vis.length - 1 : 0;
    }
  }

  const chart = pick
    ? buildChartPayload(pick.a, pick.candles, d, {
        entry: j.entry,
        stop: j.stop,
        tp1: j.tp1,
        exit: j.exitPrice ?? data.price,
        entryK,
      })
    : null;

  return {
    id: `${j.id}-exit-${Date.now()}`,
    symbol: j.symbol,
    t: Date.now(),
    kind: "exit",
    signal: "EXIT",
    outcome: j.outcome,
    confidence: j.confidence,
    timeframe: pick?.tf ?? "1h",
    entry: j.entry,
    stop: j.stop,
    tp1: j.tp1,
    tp2: null,
    pnlPct: pnl,
    heldMs: heldOf(j),
    flowRead:
      j.outcome === "win"
        ? `هدف برخورد کرد — خوانش لحظهٔ ورود (جریان ${j.features.flowAligned ? "هم‌راستا" : "ناهم‌راستا"}، MTF ${j.features.mtfAligned ? "هم‌راستا" : "ناهم‌راستا"}) محقق شد.`
        : j.outcome === "loss"
          ? `استاپ خورد — مغز این را «شهریه» ثبت می‌کند: وزن‌ها را طوری تنظیم می‌کند که دفعهٔ بعد این ستاپ امتیاز کمتری بگیرد.`
          : j.outcome === "expired"
            ? `در افق سشن تصمیمی نگرفت — پوزیشن بدون سود/زیان بسته شد.`
            : `با یک سیگنال ساختار بهتر جایگزین شد.`,
    reasoning: reasoning.map(faBidi),
    invalidation: "",
    brainVersion,
    chart,
  };
}

export function buildNoteMessage(params: {
  symbol: string;
  notes: string[];
  brainVersion: number;
  factors: BrainFactors;
}): AIMessage {
  const { symbol, notes, brainVersion, factors } = params;
  return {
    id: `${symbol}-note-${brainVersion}-${Date.now()}`,
    symbol,
    t: Date.now(),
    kind: "note",
    signal: "NOTE",
    confidence: 100,
    timeframe: "—",
    entry: null,
    stop: null,
    tp1: null,
    tp2: null,
    flowRead: "به‌روزرسانی خودکار مغز انجام شد.",
    reasoning: notes.filter((n) => n.trim().length > 0).slice(-3),
    invalidation: "",
    factors,
    brainVersion,
    chart: null,
  };
}

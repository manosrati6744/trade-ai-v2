/**
 * SNIPER AI — adaptive brain.
 *
 * File-backed journal that tracks every AI verdict as a virtual position,
 * evaluates win/loss against later market prices, and tunes emphasis factors
 * (volume-flow, structure, MTF, zone quality) from its own track record.
 * Each tuning pass bumps the brain version — the AI literally learns daily.
 */

import fs from "fs";
import path from "path";

export interface AIVerdict {
  signal: "BUY" | "SELL" | "WAIT";
  confidence: number; // 0..100
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  timeframe: string;
  flowRead: string;
  reasoning: string[];
  invalidation: string;
}

export interface BrainFactors {
  flow: number; // volume-flow emphasis
  structure: number; // BOS/CHoCH emphasis
  mtf: number; // multi-timeframe alignment emphasis
  zone: number; // OB/FVG zone-quality emphasis
}

export interface JournalEntry {
  id: string;
  symbol: string;
  signal: "BUY" | "SELL";
  side: "LONG" | "SHORT";
  entry: number;
  stop: number;
  tp1: number;
  confidence: number;
  features: { flowAligned: boolean; mtfAligned: boolean; zoneTapped: boolean };
  tOpen: number;
  tClosed?: number;
  exitPrice?: number;
  outcome: "open" | "win" | "loss" | "superseded" | "expired";
}

export interface BrainState {
  version: number;
  factors: BrainFactors;
  notes: string[];
  history: JournalEntry[];
  stats: { wins: number; losses: number; tuneMark: number };
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const BRAIN_FILE = path.join(DATA_DIR, "ai-brain.json");
const MAX_HISTORY = 240;
const EVAL_AFTER_MS = 12 * 60_000; // give trades 12 min of room (5m TF context)
const EXPIRE_MS = 8 * 3600_000; // 8h session horizon
const TUNE_EVERY = 10; // evaluate every N resolved trades

function defaultBrain(): BrainState {
  return {
    version: 1,
    factors: { flow: 1, structure: 1, mtf: 1, zone: 1 },
    notes: ["مغز راه‌اندازی شد — نسخهٔ پایهٔ پلی‌بوک SMC v1."],
    history: [],
    stats: { wins: 0, losses: 0, tuneMark: 0 },
  };
}

export function loadBrain(): BrainState {
  try {
    if (!fs.existsSync(BRAIN_FILE)) return defaultBrain();
    const raw = JSON.parse(fs.readFileSync(BRAIN_FILE, "utf8")) as BrainState;
    if (!raw || typeof raw.version !== "number" || !Array.isArray(raw.history)) {
      return defaultBrain();
    }
    return raw;
  } catch {
    return defaultBrain();
  }
}

export function saveBrain(b: BrainState): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = BRAIN_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(b));
    fs.renameSync(tmp, BRAIN_FILE);
  } catch {
    /* storage unavailable — brain runs in-memory this session */
  }
}

export function brainStats(b: BrainState) {
  const evaluated = b.history.filter((h) => h.outcome === "win" || h.outcome === "loss");
  const wins = evaluated.filter((h) => h.outcome === "win").length;
  const losses = evaluated.length - wins;
  const open = b.history.filter((h) => h.outcome === "open").length;
  return {
    version: b.version,
    factors: b.factors,
    notes: b.notes.slice(-4),
    tracked: evaluated.length,
    open,
    accuracy: evaluated.length ? Math.round((wins / evaluated.length) * 100) : null,
    wins,
    losses,
  };
}

/** Resolve open virtual positions for `symbol` against the latest price. */
function evaluateOpen(
  b: BrainState,
  symbol: string,
  price: number,
  now: number
): JournalEntry[] {
  const resolved: JournalEntry[] = [];
  for (const h of b.history) {
    if (h.outcome !== "open" || h.symbol !== symbol) continue;
    if (now - h.tOpen < EVAL_AFTER_MS) continue;
    if (now - h.tOpen > EXPIRE_MS) {
      h.outcome = "expired";
      h.tClosed = now;
      h.exitPrice = price;
      resolved.push({ ...h });
      continue;
    }
    const hitTp = h.side === "LONG" ? price >= h.tp1 : price <= h.tp1;
    const hitSl = h.side === "LONG" ? price <= h.stop : price >= h.stop;
    if (hitTp || hitSl) {
      h.outcome = hitTp ? "win" : "loss";
      h.tClosed = now;
      h.exitPrice = price;
      if (h.outcome === "win") b.stats.wins++;
      else b.stats.losses++;
      resolved.push({ ...h });
    }
  }
  return resolved;
}

/** Adaptive tuning — nudges factor emphasis from the brain's own outcomes. */
function tune(
  b: BrainState,
  featuresOf: (h: JournalEntry) => boolean,
  key: keyof BrainFactors
): boolean {
  const sample = b.history.filter(
    (h) => (h.outcome === "win" || h.outcome === "loss") && featuresOf(h)
  );
  if (sample.length < 6) return false;
  const wins = sample.filter((h) => h.outcome === "win").length;
  const wr = wins / sample.length;
  const before = b.factors[key];
  if (wr >= 0.55) b.factors[key] = Math.min(1.4, b.factors[key] + 0.05);
  else if (wr <= 0.45) b.factors[key] = Math.max(0.7, b.factors[key] - 0.05);
  if (b.factors[key] !== before) {
    b.notes.push(
      `وزن ${key.toUpperCase()} ${b.factors[key] > before ? "افزایش" : "کاهش"} یافت به ${b.factors[key].toFixed(2)} — نرخ برد ${Math.round(wr * 100)}٪ در ${sample.length} معاملهٔ هم‌راستا.`
    );
    return true;
  }
  return false;
}

function maybeTune(b: BrainState): boolean {
  const resolved = b.stats.wins + b.stats.losses;
  if (resolved < TUNE_EVERY || resolved - b.stats.tuneMark < TUNE_EVERY) return false;
  b.stats.tuneMark = resolved;
  let changed = tune(b, (h) => h.features.flowAligned, "flow");
  changed = tune(b, (h) => h.features.mtfAligned, "mtf") || changed;
  changed = tune(b, (h) => h.features.zoneTapped, "zone") || changed;
  b.notes.push(
    `پاس تنظیم وزن‌ها در ${resolved} معاملهٔ بسته‌شده (${b.stats.wins} برد / ${b.stats.losses} باخت).`
  );
  b.version++;
  return true;
}

/**
 * Evaluate open virtual positions for a symbol without taking a new verdict.
 * Used by the message feed to detect exits between AI refreshes.
 */
export function refreshPositions(
  symbol: string,
  price: number
): { brain: BrainState; resolved: JournalEntry[]; prevVersion: number } {
  const b = loadBrain();
  const prevVersion = b.version;
  const now = Date.now();
  const resolved = evaluateOpen(b, symbol, price, now);
  if (resolved.length > 0) {
    if (maybeTune(b)) b.notes.push(`مغز خودکار به v${b.version} به‌روزرسانی شد.`);
    saveBrain(b);
  }
  return { brain: b, resolved, prevVersion };
}

/**
 * Upsert the tracked position for the current verdict and run evaluations.
 * Returns updated brain (already saved) plus the entries resolved this call.
 */
export function trackVerdict(
  symbol: string,
  verdict: AIVerdict,
  price: number,
  features: JournalEntry["features"]
): { brain: BrainState; resolved: JournalEntry[] } {
  const b = loadBrain();
  const now = Date.now();
  const resolved = evaluateOpen(b, symbol, price, now);

  if (verdict.signal === "BUY" || verdict.signal === "SELL") {
    if (verdict.entry != null && verdict.stop != null && verdict.tp1 != null) {
      const active = b.history.find((h) => h.symbol === symbol && h.outcome === "open");
      const sameSignal =
        active &&
        active.signal === verdict.signal &&
        Math.abs(active.entry - verdict.entry) / verdict.entry < 0.002;
      if (active && !sameSignal) {
        active.outcome = "superseded";
        active.tClosed = now;
        active.exitPrice = price;
        resolved.push({ ...active });
      }
      if (!sameSignal) {
        b.history.push({
          id: `${symbol}-${now}`,
          symbol,
          signal: verdict.signal,
          side: verdict.signal === "BUY" ? "LONG" : "SHORT",
          entry: verdict.entry,
          stop: verdict.stop,
          tp1: verdict.tp1,
          confidence: verdict.confidence,
          features,
          tOpen: now,
          outcome: "open",
        });
      }
    }
  }

  while (b.history.length > MAX_HISTORY) b.history.shift();
  if (maybeTune(b)) {
    b.notes.push(`مغز خودکار به v${b.version} به‌روزرسانی شد.`);
  }
  saveBrain(b);
  return { brain: b, resolved };
}

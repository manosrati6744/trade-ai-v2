/**
 * Price-action layer: market regime (range / channel / trend), horizontal
 * range boundaries, regression channel, breakout & fake-breakout detection.
 *
 * Pure functions over the same candle arrays the SMC engine analyzes —
 * indices follow the engine convention (relative to the passed array).
 * Detection model, in trading terms:
 *
 *   RANGE      — clustered swing highs/lows with >=2 touches per side,
 *                width sane vs ATR, price contained.
 *   CHANNEL    — linear regression over the recent closes; upper/lower are
 *                parallel residual envelopes, validity = R^2 + sane width.
 *   BREAKOUT   — first close beyond a boundary (range edge / channel line),
 *                strength from penetration depth (ATR) + volume expansion.
 *   FAKE       — (a) wick poked beyond the boundary but the close came back
 *                inside (trap bar), or (b) a close outside that was reclaimed
 *                within 3 bars (failed breakout / stop-run).
 */

import { atr, findSwings, type Candle } from "@/lib/smc/engine";

export type PARegime =
  | "range"
  | "channel-up"
  | "channel-down"
  | "trend-up"
  | "trend-down";

export interface PARange {
  hi: number;
  lo: number;
  hiTouches: number;
  loTouches: number;
  widthAtr: number;
  widthPct: number;
  /** consecutive trailing candles whose close stayed inside */
  bars: number;
  /** 0..100 — where price sits inside the range right now */
  pos: number;
  /** first candle index (relative to the analyzed array) the range covers */
  iStart: number;
}

export interface PAChannel {
  /** price change per bar (absolute) */
  slopePerBar: number;
  /** mid-line value at iStart — upper/lower = mid(i) ± halfWidth */
  mid0: number;
  halfWidth: number;
  iStart: number;
  iEnd: number;
  strength: number; // R² 0..100
  widthAtr: number;
  type: "ascending" | "descending" | "horizontal";
  pos: number; // 0..100 inside the channel right now
  upper: number; // values at the latest bar (for the card)
  lower: number;
  mid: number;
}

export interface PABreakout {
  dir: "up" | "down";
  boundary: number;
  i: number;
  t: number;
  barsAgo: number;
  strength: number; // 0..100
  volumeRatio: number;
  confirmed: boolean; // closed >=0.15 ATR beyond the boundary
  source: "range" | "channel";
}

export interface PAFakeout {
  dir: "up" | "down"; // direction of the FAILED move
  boundary: number;
  i: number;
  t: number;
  barsAgo: number;
  strength: number; // 0..100
  wickOnly: boolean; // poked beyond but closed back inside same candle
  reclaim: boolean; // closed outside, reclaimed within 3 bars
  source: "range" | "channel";
}

export interface PriceAction {
  regime: PARegime;
  range: PARange | null;
  channel: PAChannel | null;
  breakouts: PABreakout[]; // newest first, max 3
  fakeouts: PAFakeout[]; // newest first, max 3
  status: string; // one-line Persian read of the current state
  notes: string[]; // Persian bullet lines for the card
}

const RANGE_WIN = 90;
const CHAN_WIN = 60;
const BO_WIN = 30;
const FAKE_WIN = 40;
const TREND_SLOPE = 0.06; // ATR per bar that separates flat from sloped
const MIN_R2 = 0.5;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const last = <T,>(arr: T[]): T | undefined => arr[arr.length - 1];

/** display helper — trims float noise: 102.169996 -> "102.17" */
const fmtNum = (v: number): string => {
  const s = Math.abs(v) >= 1000 ? v.toFixed(2) : v.toFixed(4);
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/* ------------------------------------------------------------------ */
/* Range detection — clustered swing highs/lows with touch counting    */
/* ------------------------------------------------------------------ */

function findRange(
  candles: Candle[],
  a: number,
  price: number
): PARange | null {
  const n = candles.length;
  if (n < 40) return null;
  const win = candles.slice(-RANGE_WIN);
  const off = n - win.length;
  const tol = a * 0.35;

  const touchesAt = (level: number, side: "high" | "low"): number => {
    let t = 0;
    for (const c of win) {
      const p = side === "high" ? c.h : c.l;
      if (Math.abs(p - level) <= tol) t++;
    }
    return t;
  };

  const best = (side: "high" | "low"): { level: number; touches: number } | null => {
    const swings = findSwings(win, 3).filter((s) => s.type === side);
    if (!swings.length) return null;
    let bestLvl = 0;
    let bestT = 0;
    for (const s of swings) {
      const t = touchesAt(s.price, side);
      // tie-break: prefer the level closest to current price
      if (
        t > bestT ||
        (t === bestT && Math.abs(s.price - price) < Math.abs(bestLvl - price))
      ) {
        bestT = t;
        bestLvl = s.price;
      }
    }
    return bestT >= 2 ? { level: bestLvl, touches: bestT } : null;
  };

  const r = best("high");
  const s = best("low");
  if (!r || !s) return null;
  const hi = Math.max(r.level, s.level);
  const lo = Math.min(r.level, s.level);
  const width = hi - lo;
  if (width < a * 0.8 || width > a * 6) return null;

  // range must have formed at least a few bars ago
  const hiTouches = touchesAt(r.level, "high");
  const loTouches = touchesAt(s.level, "low");
  if (hiTouches + loTouches < 4) return null;

  let bars = 0;
  for (let i = n - 1; i >= off; i--) {
    const c = candles[i].c;
    if (c >= lo - tol * 0.3 && c <= hi + tol * 0.3) bars++;
    else break;
  }

  return {
    hi,
    lo,
    hiTouches,
    loTouches,
    widthAtr: Math.round((width / a) * 10) / 10,
    widthPct: Math.round(((width / price) * 100) * 100) / 100,
    bars,
    pos: clamp(((price - lo) / (width || 1)) * 100, 0, 100),
    iStart: off,
  };
}

/* ------------------------------------------------------------------ */
/* Channel detection — regression + residual envelope                  */
/* ------------------------------------------------------------------ */

function findChannel(
  candles: Candle[],
  a: number,
  price: number
): PAChannel | null {
  const n = candles.length;
  const len = Math.min(CHAN_WIN, n);
  if (len < 30) return null;
  const iStart = n - len;

  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = iStart; i < n; i++) {
    const y = candles[i].c;
    sx += i;
    sy += y;
    sxx += i * i;
    sxy += i * y;
  }
  const d = len * sxx - sx * sx;
  if (Math.abs(d) < 1e-9) return null;
  const b = (len * sxy - sx * sy) / d;
  const c0 = (sy - b * sx) / len;

  let minRes = Infinity;
  let maxRes = -Infinity;
  let ssTot = 0;
  const mean = sy / len;
  for (let i = iStart; i < n; i++) {
    const res = candles[i].c - (c0 + b * i);
    minRes = Math.min(minRes, res);
    maxRes = Math.max(maxRes, res);
    ssTot += (candles[i].c - mean) ** 2;
  }
  let ssRes = 0;
  for (let i = iStart; i < n; i++) ssRes += (candles[i].c - (c0 + b * i)) ** 2;
  const r2 = ssTot > 0 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;
  if (r2 < MIN_R2) return null;

  const offMid = (maxRes + minRes) / 2;
  const halfWidth = (maxRes - minRes) / 2;
  const widthAtr = (halfWidth * 2) / a;
  if (widthAtr < 1 || widthAtr > 10) return null;

  const mid0 = c0 + offMid;
  const slopeAtr = b / a;
  const upper = mid0 + b * (n - 1) + halfWidth;
  const lower = mid0 + b * (n - 1) - halfWidth;
  const pos = clamp(((price - lower) / (upper - lower || 1)) * 100, 0, 100);
  const type =
    slopeAtr > TREND_SLOPE
      ? "ascending"
      : slopeAtr < -TREND_SLOPE
        ? "descending"
        : "horizontal";

  return {
    slopePerBar: Math.round(b * 1e6) / 1e6,
    mid0: Math.round(mid0 * 1e6) / 1e6,
    halfWidth: Math.round(halfWidth * 1e6) / 1e6,
    iStart,
    iEnd: n - 1,
    strength: Math.round(r2 * 100),
    widthAtr: Math.round(widthAtr * 10) / 10,
    type,
    pos,
    upper,
    lower,
    mid: mid0 + b * (n - 1),
  };
}

/** channel mid/upper/lower value at absolute index i */
export function channelAt(ch: PAChannel, i: number): { mid: number; upper: number; lower: number } {
  const mid = ch.mid0 + ch.slopePerBar * (i - ch.iStart);
  return { mid, upper: mid + ch.halfWidth, lower: mid - ch.halfWidth };
}

/* ------------------------------------------------------------------ */
/* Volume expansion helper                                             */
/* ------------------------------------------------------------------ */

function volRatio(candles: Candle[], i: number): number {
  if (candles[i].v <= 0) return 1;
  const from = Math.max(0, i - 20);
  let sum = 0;
  let cnt = 0;
  for (let k = from; k < i; k++) {
    sum += candles[k].v;
    cnt++;
  }
  const avg = cnt ? sum / cnt : 0;
  return avg > 0 ? candles[i].v / avg : 1;
}

/* ------------------------------------------------------------------ */
/* Breakout / fake-breakout scan                                       */
/* ------------------------------------------------------------------ */

interface Boundary {
  level: number; // fixed, or NaN when sloped
  source: "range" | "channel";
  dir: "up" | "down"; // which side of the structure
  at: (i: number) => number; // boundary value at bar i
}

function collectBoundaries(range: PARange | null, channel: PAChannel | null): Boundary[] {
  const out: Boundary[] = [];
  if (range) {
    out.push({ level: range.hi, source: "range", dir: "up", at: () => range.hi });
    out.push({ level: range.lo, source: "range", dir: "down", at: () => range.lo });
  }
  if (channel && channel.type !== "horizontal") {
    out.push({
      level: NaN,
      source: "channel",
      dir: "up",
      at: (i) => channelAt(channel, i).upper,
    });
    out.push({
      level: NaN,
      source: "channel",
      dir: "down",
      at: (i) => channelAt(channel, i).lower,
    });
  }
  return out;
}

function scanBreakouts(
  candles: Candle[],
  bounds: Boundary[],
  a: number
): PABreakout[] {
  const n = candles.length;
  const from = Math.max(1, n - BO_WIN);
  const out: PABreakout[] = [];
  for (const b of bounds) {
    for (let i = n - 1; i >= from; i--) {
      const prev = candles[i - 1].c;
      const c = candles[i].c;
      const lvl = b.at(i);
      const lvlPrev = b.at(i - 1);
      const beyondUp = c > lvl + a * 0.05 && prev <= lvlPrev + a * 0.05;
      const beyondDown = c < lvl - a * 0.05 && prev >= lvlPrev - a * 0.05;
      if (b.dir === "up" ? beyondUp : beyondDown) {
        const depth = Math.abs(c - lvl) / a;
        const vr = volRatio(candles, i);
        const confirmed = depth >= 0.15;
        out.push({
          dir: b.dir,
          boundary: Math.round(lvl * 1e6) / 1e6,
          i,
          t: candles[i].t,
          barsAgo: n - 1 - i,
          strength: Math.round(clamp(45 * depth + 25 * Math.min(vr - 1, 1.2) + (confirmed ? 22 : 0), 5, 100)),
          volumeRatio: Math.round(vr * 10) / 10,
          confirmed,
          source: b.source,
        });
        break; // most recent breakout episode on this boundary
      }
    }
  }
  return out.sort((x, y) => y.i - x.i).slice(0, 3);
}

function scanFakeouts(
  candles: Candle[],
  bounds: Boundary[],
  a: number
): PAFakeout[] {
  const n = candles.length;
  const from = Math.max(1, n - FAKE_WIN);
  const out: PAFakeout[] = [];
  const taken = new Set<string>(); // dedupe wick-only vs reclaim on same bar/dir

  for (const b of bounds) {
    for (let i = Math.max(from, 1); i < n; i++) {
      const c = candles[i];
      const lvl = b.at(i);
      const lvlPrev = b.at(i - 1);
      const closedOutside = b.dir === "up" ? c.c > lvl + a * 0.05 : c.c < lvl - a * 0.05;
      const prevInside = b.dir === "up" ? candles[i - 1].c <= lvlPrev + a * 0.05 : candles[i - 1].c >= lvlPrev - a * 0.05;

      // (a) wick-only trap: poked beyond the boundary, close back inside
      if (!closedOutside) {
        const poke = b.dir === "up" ? c.h - lvl : lvl - c.l;
        if (poke > a * 0.12 && prevInside) {
          const vr = volRatio(candles, i);
          const key = `${b.dir}:${i}`;
          if (!taken.has(key)) {
            taken.add(key);
            out.push({
              dir: b.dir,
              boundary: Math.round(lvl * 1e6) / 1e6,
              i,
              t: c.t,
              barsAgo: n - 1 - i,
              strength: Math.round(clamp(50 * (poke / a) + 25 * Math.min(vr - 1, 1.2), 10, 100)),
              wickOnly: true,
              reclaim: false,
              source: b.source,
            });
          }
          continue;
        }
      }

      // (b) failed breakout: closed outside, reclaimed within the next 3 bars
      if (closedOutside && prevInside) {
        for (let j = i + 1; j <= Math.min(i + 3, n - 1); j++) {
          const backInside = b.dir === "up" ? candles[j].c < lvl : candles[j].c > lvl;
          if (backInside) {
            const depth = Math.abs(candles[i].c - lvl) / a;
            const vr = volRatio(candles, i);
            const key = `${b.dir}:${i}`;
            if (!taken.has(key)) {
              taken.add(key);
              out.push({
                dir: b.dir,
                boundary: Math.round(lvl * 1e6) / 1e6,
                i,
                t: candles[i].t,
                barsAgo: n - 1 - i,
                strength: Math.round(clamp(45 * depth + 25 * Math.min(vr - 1, 1.2) + 15, 15, 100)),
                wickOnly: false,
                reclaim: true,
                source: b.source,
              });
            }
            break;
          }
        }
      }
    }
  }
  return out.sort((x, y) => y.i - x.i).slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Persian status / notes                                              */
/* ------------------------------------------------------------------ */

const REGIME_FA: Record<PARegime, string> = {
  range: "رنج (بازار خنثی)",
  "channel-up": "کانال صعودی",
  "channel-down": "کانال نزولی",
  "trend-up": "روند صعودی",
  "trend-down": "روند نزولی",
};

function buildText(
  regime: PARegime,
  range: PARange | null,
  channel: PAChannel | null,
  bos: PABreakout[],
  fakes: PAFakeout[]
): { status: string; notes: string[] } {
  const notes: string[] = [];
  const bo = bos[0];
  const fk = fakes[0];

  let status: string;
  if (fk && fk.barsAgo <= 3) {
    status =
      fk.dir === "up"
        ? `فیک‌شکست صعودی (${fk.barsAgo} کندل پیش) — تلهٔ خریداران؛ انتظار فشار فروش تا مرز ${fmtNum(fk.boundary)}`
        : `فیک‌شکست نزولی (${fk.barsAgo} کندل پیش) — تلهٔ فروشندگان؛ احتمال برگشت به بالای مرز ${fmtNum(fk.boundary)}`;
  } else if (bo && bo.barsAgo <= 3 && bo.confirmed) {
    status = `شکست ${bo.dir === "up" ? "صعودی" : "نزولی"} ${bo.source === "range" ? "رنج" : "کانال"} تأییدشده (${bo.barsAgo} کندل پیش، حجم ${bo.volumeRatio}×) — پولبک به ${fmtNum(bo.boundary)} کلید ورود`;
  } else if (regime === "range" && range) {
    status =
      range.pos >= 78
        ? `قیمت چسبیده به سقف رنج (${Math.round(range.pos)}٪ ارتفاع) — مراقب فیک‌شکست یا رد شدن از ${fmtNum(range.hi)}`
        : range.pos <= 22
          ? `قیمت چسبیده به کف رنج (${Math.round(range.pos)}٪ ارتفاع) — مراقب فیک‌شکست یا رد شدن از ${fmtNum(range.lo)}`
          : `قیمت در میانهٔ رنج (${Math.round(range.pos)}٪) — تا شکست مرزها، معامله در مرزها منطقی‌تر است`;
  } else if (regime === "channel-up" && channel) {
    status = `کانال صعودی فعال (قدرت ${channel.strength}٪) — قیمت ${Math.round(channel.pos)}٪ ارتفاع کانال؛ کف کانال حمایتی و سقف آن مقاومتی`;
  } else if (regime === "channel-down" && channel) {
    status = `کانال نزولی فعال (قدرت ${channel.strength}٪) — قیمت ${Math.round(channel.pos)}٪ ارتفاع کانال؛ پولبک به سقف کانال فرصت فروش`;
  } else if (regime === "trend-up" || regime === "trend-down") {
    status = `${REGIME_FA[regime]} — ساختار رنج/کانال معتبری یافت نشد؛ سیگنال‌های شکست فقط در جهت روند معتبرترند`;
  } else {
    status = "ساختار رنج/کانال معتبری در این تایم‌فریم پیدا نشد — بازار در حال شکل‌دادن است";
  }

  if (range) {
    notes.push(
      `مرزهای رنج: سقف ${fmtNum(range.hi)} / کف ${fmtNum(range.lo)} — عرض ${range.widthAtr}×ATR (حدود ${range.widthPct}٪)`,
      `${range.hiTouches} برخورد به سقف و ${range.loTouches} برخورد به کف — ${range.hiTouches + range.loTouches >= 6 ? "رنج معتبر و جاافتاده" : "رنج جوان؛ مرزها شکننده‌ترند"}`
    );
  }
  if (channel) {
    const typeFa =
      channel.type === "ascending" ? "صعودی" : channel.type === "descending" ? "نزولی" : "افقی";
    notes.push(
      `کانال ${typeFa}: سقف ${fmtNum(channel.upper)} / کف ${fmtNum(channel.lower)} — قدرت ساختار ${channel.strength}٪، عرض ${channel.widthAtr}×ATR`
    );
  }
  if (bo) {
    notes.push(
      `آخرین شکست: ${bo.dir === "up" ? "صعودی" : "نزولی"} از ${bo.source === "range" ? "مرز رنج" : "خط کانال"} ${bo.boundary} — ${bo.barsAgo === 0 ? "همین کندل" : `${bo.barsAgo} کندل پیش`}، ${bo.confirmed ? "تأییدشده" : "ضعیف/غیرمؤکد"}، حجم ${bo.volumeRatio}× میانگین`
    );
  }
  if (fk) {
    notes.push(
      `آخرین فیک‌شکست: ${fk.dir === "up" ? "صعودی" : "نزولی"} روی ${fk.boundary} — ${fk.barsAgo === 0 ? "همین کندل" : `${fk.barsAgo} کندل پیش`}، ${fk.wickOnly ? "سایهٔ تله (کلوز داخل مرز)" : "کلوز خارج و بازگشت تا ۳ کندل"}، قدرت ${fk.strength}٪`
    );
  }
  return { status, notes };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function analyzePriceAction(
  candles: Candle[],
  trend: "bullish" | "bearish" | "ranging"
): PriceAction {
  const empty: PriceAction = {
    regime: trend === "bullish" ? "trend-up" : trend === "bearish" ? "trend-down" : "range",
    range: null,
    channel: null,
    breakouts: [],
    fakeouts: [],
    status: "دادهٔ کافی برای تحلیل پرایس‌اکشن نیست",
    notes: [],
  };
  if (candles.length < 40) return empty;

  const price = last(candles)!.c;
  const a = atr(candles);
  if (!(a > 0)) return empty;

  const range = findRange(candles, a, price);
  const channel = findChannel(candles, a, price);
  const bounds = collectBoundaries(range, channel);
  const breakouts = scanBreakouts(candles, bounds, a);
  const fakeouts = scanFakeouts(candles, bounds, a);

  // regime: range wins when the regression is flat or the channel is loose
  let regime: PARegime;
  const slopeAtr = channel ? channel.slopePerBar / a : 0;
  if (range && (!channel || Math.abs(slopeAtr) < TREND_SLOPE || channel.strength < 62)) {
    regime = "range";
  } else if (channel) {
    regime = channel.type === "ascending" ? "channel-up" : channel.type === "descending" ? "channel-down" : "range";
  } else if (trend === "bullish") {
    regime = "trend-up";
  } else if (trend === "bearish") {
    regime = "trend-down";
  } else {
    regime = "range";
  }

  const { status, notes } = buildText(regime, range, channel, breakouts, fakeouts);
  return { regime, range, channel, breakouts, fakeouts, status, notes };
}

export const PA_REGIME_FA = REGIME_FA;

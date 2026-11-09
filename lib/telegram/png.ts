/**
 * Dependency-free PNG renderer for Telegram push images.
 *
 * Draws a dark-themed candlestick chart (price + volume + entry/SL/TP level
 * lines) into an RGBA buffer and encodes it as a PNG using node:zlib only —
 * no native canvas, no fonts, no files. Text uses a built-in 5×7 bitmap font
 * (Latin/digits), which is enough for chart annotations; Persian text lives
 * in the message caption instead.
 */

import { deflateSync } from "node:zlib";
import type { Candle } from "@/lib/smc/engine";

/* ------------------------------ tiny canvas ----------------------------- */

type RGB = [number, number, number];

class Raster {
  w: number;
  h: number;
  px: Buffer;

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0];
      this.px[i * 3 + 1] = bg[1];
      this.px[i * 3 + 2] = bg[2];
    }
  }

  set(x: number, y: number, c: RGB, alpha = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = Math.round(this.px[i] * (1 - alpha) + c[0] * alpha);
    this.px[i + 1] = Math.round(this.px[i + 1] * (1 - alpha) + c[1] * alpha);
    this.px[i + 2] = Math.round(this.px[i + 2] * (1 - alpha) + c[2] * alpha);
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, alpha = 1) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.set(xx, yy, c, alpha);
    }
  }

  hline(x0: number, x1: number, y: number, c: RGB, dash = 0, alpha = 1) {
    for (let x = x0; x <= x1; x++) if (dash <= 0 || Math.floor(x / dash) % 2 === 0) this.set(x, y, c, alpha);
  }

  vline(x: number, y0: number, y1: number, c: RGB, alpha = 1) {
    for (let y = y0; y <= y1; y++) this.set(x, y, c, alpha);
  }

  /** Bresenham for non-axis-aligned lines (used by nothing critical, kept for diagonals). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      this.set(x0, y0, c, alpha);
      if (Math.abs(x0 - x1) < 1 && Math.abs(y0 - y1) < 1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  png(): Buffer {
    // RGB → PNG color type 2 (truecolor) — smaller than RGBA, fully supported.
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0; // filter: none
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const idat = deflateSync(raw, { level: 9 });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: truecolor
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (const b of Buffer.concat([Buffer.from(type, "ascii"), data])) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/* ------------------------------ 5×7 font -------------------------------- */

// Classic GLCD 5×7 — columns left→right, bit 0 = top row.
const FONT: Record<string, [number, number, number, number, number]> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  "<": [0x00, 0x08, 0x14, 0x22, 0x41],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0x41, 0x22, 0x14, 0x08, 0x00],
  "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x01, 0x01],
  G: [0x3e, 0x41, 0x41, 0x51, 0x32],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x04, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x26, 0x49, 0x49, 0x49, 0x32],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x7f, 0x20, 0x18, 0x20, 0x7f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x03, 0x04, 0x78, 0x04, 0x03],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};

function drawText(r: Raster, text: string, x: number, y: number, c: RGB, s = 1) {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch.toUpperCase()];
    if (g) {
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 7; row++) {
          if (g[col] & (1 << row)) r.rect(cx + col * s, y + row * s, s, s, c);
        }
      }
    }
    cx += 6 * s;
  }
  return cx;
}

const textW = (text: string, s = 1) => text.length * 6 * s - s;

/* ------------------------------ chart ----------------------------------- */

const BG: RGB = [11, 15, 20];
const GRID: RGB = [29, 40, 57];
const AXIS_TXT: RGB = [130, 140, 155];
const TITLE_TXT: RGB = [229, 231, 235];
const UP: RGB = [38, 166, 154];
const DOWN: RGB = [239, 83, 80];
const VOL_UP: RGB = [38, 166, 154];
const VOL_DOWN: RGB = [239, 83, 80];

export interface ChartLevel {
  price: number;
  color: string; // hex "#RRGGBB"
  label: string; // Latin, e.g. "ENTRY 3965.15"
}

function hex2rgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const fmtK = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)));

export function renderCandlePng(opts: {
  title: string; // Latin title, e.g. "GOLD 4H SHORT"
  subtitle?: string; // Latin, e.g. "SMC SNIPER · RR 1.5"
  candles: Candle[];
  maxCandles?: number;
  levels?: ChartLevel[];
  width?: number;
  height?: number;
  digits?: number;
}): Buffer {
  const W = opts.width ?? 820;
  const H = opts.height ?? 520;
  const r = new Raster(W, H, BG);
  const cds = opts.candles.slice(-(opts.maxCandles ?? 90));
  if (cds.length < 2) return r.png();
  const digits = opts.digits ?? 2;

  const TITLE_H = 30;
  const TIME_H = 16;
  const VOL_H = 74;
  const AX_W = 76;
  const plotX0 = 8, plotX1 = W - AX_W;
  const priceY0 = TITLE_H + 8, priceY1 = H - VOL_H - TIME_H - 8;
  const volY0 = H - VOL_H - TIME_H, volY1 = H - TIME_H;

  // title bar
  r.rect(0, 0, W, TITLE_H - 6, [17, 24, 36]);
  drawText(r, opts.title, plotX0 + 4, 8, TITLE_TXT, 2);
  if (opts.subtitle) drawText(r, opts.subtitle, plotX1 - textW(opts.subtitle, 1) - 6, 11, AXIS_TXT, 1);

  // price scale (include levels so lines always fit)
  let lo = Infinity, hi = -Infinity;
  for (const c of cds) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  for (const lv of opts.levels ?? []) {
    lo = Math.min(lo, lv.price);
    hi = Math.max(hi, lv.price);
  }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const py = (p: number) => priceY1 - ((p - lo) / (hi - lo)) * (priceY1 - priceY0);

  // grid + axis labels (6 ticks)
  for (let i = 0; i <= 5; i++) {
    const p = lo + ((hi - lo) * i) / 5;
    const y = py(p);
    r.hline(plotX0, plotX1, Math.round(y), GRID, 0, 0.7);
    drawText(r, p.toFixed(digits), plotX1 + 6, Math.round(y) - 3, AXIS_TXT, 1);
  }

  // candles
  const n = cds.length;
  const slot = (plotX1 - plotX0) / n;
  const bw = Math.max(2, Math.min(11, Math.floor(slot * 0.62)));
  let maxVol = 0;
  for (const c of cds) maxVol = Math.max(maxVol, c.v);
  for (let i = 0; i < n; i++) {
    const c = cds[i];
    const cx = Math.round(plotX0 + slot * i + slot / 2);
    const col = c.c >= c.o ? UP : DOWN;
    r.vline(cx, Math.round(py(c.h)), Math.round(py(c.l)), col, 0.95);
    const yO = Math.round(py(c.o)), yC = Math.round(py(c.c));
    r.rect(cx - Math.floor(bw / 2), Math.min(yO, yC), bw, Math.max(1, Math.abs(yC - yO)), col);
    // volume bar
    const vh = maxVol > 0 ? Math.round((c.v / maxVol) * (VOL_H - 14)) : 0;
    if (vh > 0) r.rect(cx - Math.floor(bw / 2), volY1 - vh, bw, vh, c.c >= c.o ? VOL_UP : VOL_DOWN, 0.55);
  }
  // volume separator + max label
  r.hline(plotX0, plotX1, volY0, GRID, 0, 0.7);
  drawText(r, `VOL MAX ${fmtK(maxVol)}`, plotX0 + 4, volY0 + 3, AXIS_TXT, 1);

  // level lines (on top of candles) with price chips on the axis
  for (const lv of opts.levels ?? []) {
    const y = Math.round(py(lv.price));
    const c = hex2rgb(lv.color);
    r.hline(plotX0, plotX1, y, c, 3, 0.95);
    const chip = lv.price.toFixed(digits);
    const cw = textW(chip, 1) + 8;
    r.rect(plotX1 + 4, y - 6, cw, 13, c);
    drawText(r, chip, plotX1 + 8, y - 3, [10, 12, 16], 1);
    const lbl = lv.label;
    drawText(r, lbl, plotX0 + 4, y - 14, c, 1);
  }

  // time axis ticks (5 evenly spaced candle timestamps)
  for (let k = 0; k < 5; k++) {
    const i = Math.min(n - 1, Math.round((k * (n - 1)) / 4));
    const d = new Date(cds[i].t * 1000);
    const lbl = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const x = Math.round(plotX0 + slot * i + slot / 2);
    drawText(r, lbl, Math.min(x, plotX1 - textW(lbl, 1)), volY1 + 4, AXIS_TXT, 1);
  }

  return r.png();
}

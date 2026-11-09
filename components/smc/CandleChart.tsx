"use client";

import { useEffect, useRef, useState } from "react";
import {
  flowSeries,
  type Candle,
  type CandleFlow,
  type TFAnalysis,
} from "@/lib/smc/engine";
import type { ConsensusPosition } from "@/lib/smc/consensus";

interface Props {
  candles: Candle[];
  analysis: TFAnalysis;
  digits: number;
  height?: number;
  /** the ONE unified theory (all modules fused, AI included) — the only thing
   *  drawn on this chart: direction badge + entry zone + ENTRY/SL/TP1/TP2 */
  theory?: ConsensusPosition | null;
}

interface HoverInfo {
  idx: number; // index into candles[]
  x: number;
  y: number;
  w: number; // canvas width at event time
}

const UP = "#22c55e";
const DOWN = "#ef4444";
const GRID = "#1a212e";
const TEXT = "#7c8698";
const AMBER = "#f59e0b";
const BG_DARK = "#0b0e11";
const ENTRY = "#38bdf8";

function fmtK(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${s}${(a / 1_000).toFixed(1)}K`;
  return `${s}${Math.round(a)}`;
}

export default function CandleChart({ candles, analysis, digits, height = 340, theory }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // schematic structures (OB/FVG zones + range/channel regime shape) — user
  // asked them BACK on the chart, drawn clean; toggle persists locally
  const [structs, setStructs] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("smc-structures-v1") !== "0";
  });
  const toggleStructs = () =>
    setStructs((v) => {
      window.localStorage.setItem("smc-structures-v1", v ? "0" : "1");
      return !v;
    });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || candles.length < 2) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = height;
      if (w < 50) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const N = Math.min(candles.length, 90);
      const vis = candles.slice(-N);
      const offset = candles.length - N;

      /* ---------------- layout: price area + volume pane ---------------- */
      const padR = 58;
      const padT = 8;
      const padB = 18;
      const volH = Math.max(44, Math.min(64, Math.round((h - padT - padB) * 0.2)));
      const volTop = h - padB - volH; // volume pane occupies [volTop, h-padB]
      const priceBottom = volTop - 6;
      const plotW = w - padR;
      const plotH = priceBottom - padT;

      let lo = Infinity;
      let hi = -Infinity;
      for (const c of vis) {
        lo = Math.min(lo, c.l);
        hi = Math.max(hi, c.h);
      }
      // the theory's own levels must fit the view too, not just the candles
      for (const p of [theory?.entry, theory?.stop, theory?.tp1, theory?.tp2]) {
        if (p != null && isFinite(p)) {
          lo = Math.min(lo, p);
          hi = Math.max(hi, p);
        }
      }
      // schematic structures must stay visible — but never squeeze the
      // candles: a level more than 1.5 view-heights away is ignored
      const fitLo0 = lo;
      const fitHi0 = hi;
      const span0 = Math.max(fitHi0 - fitLo0, 1e-9);
      const near = (p: number) => p > fitLo0 - span0 * 1.5 && p < fitHi0 + span0 * 1.5;
      if (structs) {
        const zonePrices = [
          ...analysis.orderBlocks.filter((o) => o.state !== "mitigated").flatMap((o) => [o.top, o.bottom]),
          ...analysis.fvgs.filter((x) => !x.filled).flatMap((x) => [x.top, x.bottom]),
        ];
        for (const p of zonePrices) {
          if (isFinite(p) && near(p)) {
            lo = Math.min(lo, p);
            hi = Math.max(hi, p);
          }
        }
      }
      const padY = (hi - lo) * 0.08;
      lo -= padY;
      hi += padY;

      const xOf = (i: number) => (plotW * (i - offset + 0.5)) / N;
      const yOf = (p: number) => padT + plotH * (1 - (p - lo) / (hi - lo));
      const bw = Math.max(2, (plotW / N) * 0.62);

      /* ---------------- per-candle DOM flow ---------------- */
      const flows: CandleFlow[] = flowSeries(vis, vis.length);
      const lastClose = vis[vis.length - 1].c;

      // grid + right price labels
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.lineWidth = 1;
      ctx.strokeStyle = GRID;
      ctx.fillStyle = TEXT;
      const rows = 4;
      for (let r = 0; r <= rows; r++) {
        const p = lo + ((hi - lo) * r) / rows;
        const y = Math.round(yOf(p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.fillText(p.toFixed(digits), plotW + 5, y + 3);
      }
      // time labels
      const step = Math.max(1, Math.ceil(N / 5));
      ctx.textAlign = "center";
      for (let k = 0; k < N; k += step) {
        const d = new Date(vis[k].t * 1000);
        const label = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        ctx.fillText(label, xOf(k + offset), h - 5);
      }
      ctx.textAlign = "left";

      /* ------- schematic structures: OB / FVG zones (behind candles) ------- */
      if (structs) {
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        const zoneX = (idx: number) => Math.max(2, xOf(idx));
        const box = (
          idx: number,
          top: number,
          bottom: number,
          fill: string,
          stroke: string,
          label: string
        ) => {
          const yT = yOf(top);
          const yB = yOf(bottom);
          if (yB < padT || yT > priceBottom || yB - yT < 1.5) return;
          const x0 = zoneX(idx);
          ctx.fillStyle = fill;
          ctx.fillRect(x0, yT, plotW - x0, yB - yT);
          ctx.strokeStyle = stroke;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(x0 + 0.5, yT + 0.5, plotW - x0 - 1, yB - yT - 1);
          ctx.setLineDash([]);
          if (yB - yT > 10) {
            ctx.fillStyle = stroke;
            ctx.fillText(label, x0 + 4, yT + 9);
          }
        };
        // order blocks — the 2 freshest on each side of price
        const obPrice = (o: { top: number; bottom: number }) => (o.top + o.bottom) / 2;
        const obs = analysis.orderBlocks
          .filter((o) => o.state !== "mitigated")
          .sort((a, b) => Math.abs(obPrice(a) - lastClose) - Math.abs(obPrice(b) - lastClose));
        for (const o of obs.filter((x) => x.kind === "demand").slice(0, 2)) {
          box(o.i, o.top, o.bottom, "rgba(34,197,94,0.10)", "rgba(34,197,94,0.55)", "OB تقاضا");
        }
        for (const o of obs.filter((x) => x.kind === "supply").slice(0, 2)) {
          box(o.i, o.top, o.bottom, "rgba(239,68,68,0.10)", "rgba(239,68,68,0.55)", "OB عرضه");
        }
        // fair value gaps — the 3 unfilled nearest to price
        const fvgs = analysis.fvgs
          .filter((x) => !x.filled)
          .sort(
            (a, b) =>
              Math.abs((a.top + a.bottom) / 2 - lastClose) - Math.abs((b.top + b.bottom) / 2 - lastClose)
          )
          .slice(0, 3);
        for (const fv of fvgs) {
          box(
            fv.i,
            fv.top,
            fv.bottom,
            fv.kind === "bullish" ? "rgba(251,191,36,0.10)" : "rgba(249,115,22,0.10)",
            fv.kind === "bullish" ? "rgba(251,191,36,0.6)" : "rgba(249,115,22,0.6)",
            "FVG"
          );
        }
      }

      // candles
      for (let i = 0; i < N; i++) {
        const c = vis[i];
        const x = xOf(i + offset);
        const col = c.c >= c.o ? UP : DOWN;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        const yH = yOf(c.h);
        const yL = yOf(c.l);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yH);
        ctx.lineTo(Math.round(x) + 0.5, yL);
        ctx.stroke();
        const yO = yOf(c.o);
        const yC = yOf(c.c);
        ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1.2, Math.abs(yC - yO)));
      }

      /* ------- regime shape: range box or channel rails (on top) ------- */
      if (structs) {
        ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
        const pa = analysis.priceAction;
        const rail = (p: number, col: string, label: string) => {
          if (!isFinite(p) || p < lo || p > hi) return;
          const y = Math.round(yOf(p)) + 0.5;
          ctx.strokeStyle = col;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(label, plotW - ctx.measureText(label).width - 4, y - 3);
        };
        if (pa.regime === "range" && pa.range && pa.range.bars >= 5) {
          const nearR =
            pa.range.hi < hi + (hi - lo) * 0.3 && pa.range.lo > lo - (hi - lo) * 0.3;
          if (nearR) {
            ctx.fillStyle = "rgba(45,212,191,0.05)";
            ctx.fillRect(0, yOf(pa.range.hi), plotW, yOf(pa.range.lo) - yOf(pa.range.hi));
            rail(pa.range.hi, "rgba(45,212,191,0.8)", `سقف رنج ×${pa.range.hiTouches}`);
            rail(pa.range.lo, "rgba(45,212,191,0.8)", `کف رنج ×${pa.range.loTouches}`);
          }
        } else if (pa.channel && (pa.regime === "channel-up" || pa.regime === "channel-down")) {
          const ch = pa.channel;
          const line = (which: "upper" | "mid" | "lower") => {
            ctx.strokeStyle =
              which === "mid" ? "rgba(45,212,191,0.3)" : "rgba(45,212,191,0.8)";
            ctx.setLineDash(which === "mid" ? [2, 4] : [6, 4]);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < N; i++) {
              const gi = i + offset; // global index in the analyzed window
              if (gi < ch.iStart) continue;
              const mid = ch.mid0 + ch.slopePerBar * (gi - ch.iStart);
              const p = which === "upper" ? mid + ch.halfWidth : which === "lower" ? mid - ch.halfWidth : mid;
              if (!isFinite(p) || p < lo - (hi - lo) || p > hi + (hi - lo)) continue;
              const x = xOf(gi);
              const y = yOf(p);
              if (!started) {
                ctx.moveTo(x, y);
                started = true;
              } else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
          };
          if (ch.upper > lo - (hi - lo) && ch.lower < hi + (hi - lo)) {
            line("upper");
            line("mid");
            line("lower");
            const lbl = `کانال ${ch.type === "ascending" ? "صعودی" : "نزولی"} · قدرت ${ch.strength}٪`;
            ctx.fillStyle = "rgba(45,212,191,0.9)";
            ctx.fillText(lbl, 4, yOf(ch.upper) - 3);
          }
        }
      }

      /* ---------------- THE unified theory — the only overlay ---------------- */
      const th = theory;
      if (th && th.entry != null && th.stop != null && th.tp1 != null) {
        const usedLabelY: number[] = [];
        const line = (p: number | null, col: string, label: string, dash: number[]) => {
          if (p == null || !isFinite(p) || p < lo || p > hi) return;
          const y = Math.round(yOf(p)) + 0.5;
          ctx.strokeStyle = col;
          ctx.setLineDash(dash);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(plotW, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 1;
          let ly = y;
          while (usedLabelY.some((u) => Math.abs(u - ly) < 14) && ly < priceBottom - 12) ly += 14;
          usedLabelY.push(ly);
          const tw = ctx.measureText(label).width + 10;
          ctx.fillStyle = col;
          ctx.fillRect(2, ly - 7.5, tw, 15);
          ctx.fillStyle = BG_DARK;
          ctx.fillText(label, 7, ly + 3.5);
        };
        // entry zone shading
        if (th.entryZone) {
          const [zb, zt] = th.entryZone;
          if (zt >= lo && zb <= hi) {
            const y1 = yOf(Math.min(zt, hi));
            const y2 = yOf(Math.max(zb, lo));
            ctx.fillStyle = "rgba(56,189,248,0.10)";
            ctx.fillRect(0, y1, plotW, y2 - y1);
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = "rgba(56,189,248,0.55)";
            ctx.strokeRect(0.5, y1 + 0.5, plotW - 1, y2 - y1 - 1);
            ctx.setLineDash([]);
            if (y2 - y1 > 11) {
              ctx.fillStyle = ENTRY;
              ctx.fillText("ناحیهٔ ورود", plotW - 60, y1 + 10);
            }
          }
        }
        line(th.entry, ENTRY, `ورود ${th.entry.toFixed(digits)}`, []);
        line(th.stop, DOWN, `استاپ ${th.stop.toFixed(digits)}`, [5, 4]);
        line(th.tp1, UP, `هدف۱ ${th.tp1.toFixed(digits)}`, [5, 4]);
        line(th.tp2, AMBER, `هدف۲ ${th.tp2?.toFixed(digits) ?? "—"}`, [5, 4]);
      }

      // current price tag
      const last = vis[vis.length - 1];
      const yP = yOf(last.c);
      if (yP > padT && yP < priceBottom) {
        ctx.strokeStyle = "rgba(232,234,237,0.75)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, Math.round(yP) + 0.5);
        ctx.lineTo(plotW, Math.round(yP) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = last.c >= last.o ? UP : DOWN;
        ctx.fillRect(plotW + 1, yP - 8, padR - 2, 16);
        ctx.fillStyle = "#050805";
        ctx.font = "bold 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(last.c.toFixed(digits), plotW + 5, yP + 3.5);
      }

      /* ---------------- volume pane: mirrored DOM bars + cum delta ---------------- */
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      // separator
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(volTop - 3.5) + 0.5);
      ctx.lineTo(plotW, Math.round(volTop - 3.5) + 0.5);
      ctx.stroke();

      let maxTot = 0;
      for (const f of flows) maxTot = Math.max(maxTot, f.buy + f.sell);
      const center = volTop + volH / 2;
      if (maxTot > 0) {
        const half = volH / 2 - 3;
        for (let i = 0; i < flows.length; i++) {
          const f = flows[i];
          const x = xOf(i + offset);
          const buyH = (f.buy / maxTot) * half;
          const sellH = (f.sell / maxTot) * half;
          ctx.fillStyle = "rgba(34,197,94,0.8)";
          ctx.fillRect(x - bw / 2, center - buyH, bw, Math.max(buyH, 0.5));
          ctx.fillStyle = "rgba(239,68,68,0.8)";
          ctx.fillRect(x - bw / 2, center, bw, Math.max(sellH, 0.5));
        }
        // center baseline
        ctx.strokeStyle = "rgba(124,134,152,0.25)";
        ctx.beginPath();
        ctx.moveTo(0, Math.round(center) + 0.5);
        ctx.lineTo(plotW, Math.round(center) + 0.5);
        ctx.stroke();

        // cumulative delta line
        let cMin = Infinity;
        let cMax = -Infinity;
        for (const f of flows) {
          cMin = Math.min(cMin, f.cumDelta);
          cMax = Math.max(cMax, f.cumDelta);
        }
        if (cMax > cMin) {
          ctx.strokeStyle = "rgba(245,158,11,0.9)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          flows.forEach((f, i) => {
            const x = xOf(i + offset);
            const y = volTop + 3 + (volH - 6) * (1 - (f.cumDelta - cMin) / (cMax - cMin));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }

      // pane labels
      ctx.fillStyle = TEXT;
      ctx.fillText("VOL", 4, volTop + 10);
      const lastFlow = flows[flows.length - 1];
      if (lastFlow) {
        const dl = fmtK(lastFlow.delta);
        ctx.fillStyle = lastFlow.delta >= 0 ? UP : DOWN;
        const txt = `Δ ${lastFlow.delta >= 0 ? "+" : ""}${dl}`;
        const tw = ctx.measureText(txt).width;
        ctx.fillText(txt, plotW - tw - 4, volTop + 10);
      }

      // hover crosshair
      if (hover && hover.idx >= offset) {
        const x = Math.round(xOf(hover.idx)) + 0.5;
        ctx.strokeStyle = "rgba(232,234,237,0.4)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, h - padB);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [candles, analysis, digits, height, hover, theory, structs]);

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = wrap.clientWidth;
    const N = Math.min(candles.length, 90);
    const offset = candles.length - N;
    const plotW = w - 58;
    const idx = Math.round((x / plotW) * N - 0.5) + offset;
    if (x < 0 || x > plotW || idx < offset || idx >= candles.length) {
      if (hover) setHover(null);
      return;
    }
    setHover({ idx, x, y: e.clientY - rect.top, w: rect.width });
  };

  const hoverCandle = hover ? candles[hover.idx] : null;
  const hoverFlowAt = (() => {
    if (!hoverCandle) return null;
    const vis = candles.slice(-Math.min(candles.length, 90));
    const flows = flowSeries(vis, vis.length);
    const pos = vis.findIndex((c) => c.t === hoverCandle.t);
    return pos >= 0 ? flows[pos] : null;
  })();

  const tooltipLeft = hover ? Math.min(Math.max(hover.x + 10, 8), hover.w - 150) : 0;
  const tooltipTop = hover ? Math.max(10, Math.min(hover.y - 120, height - 150)) : 0;
  const th = theory;
  const thLong = th?.dir === "LONG";
  const thShort = th?.dir === "SHORT";

  return (
    <div ref={wrapRef} className="relative w-full" role="img" aria-label="نمودار کندل با نظریهٔ واحد سیستم — ورود، استاپ و اهداف">
      {/* structures toggle — schematic OB/FVG + regime shape */}
      <button
        onClick={toggleStructs}
        aria-pressed={structs}
        title="نمایش شماتیک Order Block و FVG و شکل رژیم بازار (رنج/کانال) روی چارت"
        className={`absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black ring-1 backdrop-blur-sm transition-colors ${
          structs
            ? "bg-teal-500/20 text-teal-200 ring-teal-400/50"
            : "bg-[#0b0e11]/70 text-muted-foreground ring-border"
        }`}
      >
        سازه‌ها {structs ? "روشن" : "خاموش"}
      </button>
      {/* unified theory badge — the single view everything agreed on */}
      {th && (
        <div className="absolute right-2 top-2 z-10 flex max-w-[calc(100%-150px)] items-center gap-1.5" dir="rtl">
          <span
            className={`rounded-md px-2 py-1 text-[10px] font-black ring-1 backdrop-blur-sm ${
              thLong
                ? "bg-emerald-500/25 text-emerald-200 ring-emerald-400/50"
                : thShort
                  ? "bg-red-500/25 text-red-200 ring-red-400/50"
                  : "bg-amber-500/20 text-amber-200 ring-amber-400/40"
            }`}
            title={th.votes.map((vt) => `${vt.fa}: ${vt.detail}`).join("\n")}
          >
            نظریهٔ واحد: {th.headline}
          </span>
          {th.entry != null && th.stop != null && (
            <span className="rounded-md bg-[#0b0e11]/80 px-1.5 py-1 font-mono text-[9px] text-sky-300 ring-1 ring-sky-400/40 backdrop-blur-sm">
              RR {th.rr1 ?? "—"}
            </span>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="block w-full touch-pan-y"
        onPointerDown={onPointer}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || e.buttons > 0) onPointer(e);
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover && hoverCandle && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-[#0b0e11]/95 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-foreground shadow-xl"
          style={{ left: tooltipLeft, top: tooltipTop }}
        >
          <div className="mb-0.5 text-[9px] text-muted-foreground">
            {new Date(hoverCandle.t * 1000).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <div>
            O {hoverCandle.o.toFixed(digits)} · H {hoverCandle.h.toFixed(digits)}
          </div>
          <div>
            L {hoverCandle.l.toFixed(digits)} · C{" "}
            <span className={hoverCandle.c >= hoverCandle.o ? "text-emerald-400" : "text-red-400"}>
              {hoverCandle.c.toFixed(digits)}
            </span>
          </div>
          {hoverFlowAt && (
            <>
              <div className="mt-1 border-t border-border pt-1">
                <span className="text-emerald-400">BUY {fmtK(hoverFlowAt.buy)}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-red-400">SELL {fmtK(hoverFlowAt.sell)}</span>
              </div>
              <div>
                Δ <span className={hoverFlowAt.delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                  {hoverFlowAt.delta >= 0 ? "+" : ""}
                  {Math.round(hoverFlowAt.delta)}
                </span>{" "}
                <span className="text-amber-400">ΣΔ {fmtK(hoverFlowAt.cumDelta)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

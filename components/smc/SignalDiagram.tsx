"use client";

/**
 * SignalDiagram — the AI's hand-drawn sketch of its own decision.
 *
 * Renders the annotated chart payload attached to every AI message:
 * candles, the anchoring zone, ENTRY / SL / TP1 / TP2 levels, BOS/CHoCH
 * markers, the projected path toward the target (fresh entries) or the
 * realized path (exits), plus the per-candle buy/sell delta bars.
 */

import { useEffect, useRef } from "react";
import type { MessageChart } from "@/lib/ai/types";

interface Props {
  chart: MessageChart;
  signal: "BUY" | "SELL" | "WAIT" | "EXIT" | "NOTE";
  outcome?: "win" | "loss" | "expired" | "superseded";
  digits: number;
  height?: number;
}

const UP = "#22c55e";
const DOWN = "#ef4444";
const GRID = "#1a212e";
const TEXT = "#7c8698";
const ENTRY = "#e8eaed";
const AMBER = "#f59e0b";
const BG_DARK = "#0b0e11";

export default function SignalDiagram({ chart, signal, outcome, digits, height = 210 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || chart.bars.length < 2) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = height;
      if (w < 60) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const bars = chart.bars;
      const N = bars.length;
      const m = chart.marks;

      const padR = 46;
      const padT = 6;
      const padB = 14;
      const volH = 26;
      const volTop = h - padB - volH;
      const priceBottom = volTop - 4;
      const plotW = w - padR;
      const plotH = priceBottom - padT;

      // price scale: candle range + nearby levels only (avoid squashing)
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of bars) {
        lo = Math.min(lo, b.l);
        hi = Math.max(hi, b.h);
      }
      const span0 = hi - lo || 1;
      const near = (p: number | null | undefined) =>
        p != null && isFinite(p) && p > lo - span0 * 0.9 && p < hi + span0 * 0.9;
      const levels: Array<[number, string]> = [];
      for (const [p, tag] of [
        [m.entry, "E"],
        [m.stop, "SL"],
        [m.tp1, "TP1"],
        [m.tp2, "TP2"],
        [m.exit, "EXIT"],
      ] as Array<[number | null | undefined, string]>) {
        if (near(p)) {
          levels.push([p as number, tag]);
          lo = Math.min(lo, p as number);
          hi = Math.max(hi, p as number);
        }
      }
      if (m.zone) {
        if (near(m.zone[0])) lo = Math.min(lo, m.zone[0]);
        if (near(m.zone[1])) hi = Math.max(hi, m.zone[1]);
      }
      const padY = (hi - lo) * 0.07;
      lo -= padY;
      hi += padY;

      const xOf = (i: number) => (plotW * (i + 0.5)) / N;
      const yOf = (p: number) => padT + plotH * (1 - (p - lo) / (hi - lo || 1));
      const bw = Math.max(1.6, (plotW / N) * 0.6);

      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.lineWidth = 1;

      // grid + right labels
      ctx.strokeStyle = GRID;
      ctx.fillStyle = TEXT;
      for (let r = 0; r <= 3; r++) {
        const p = lo + ((hi - lo) * r) / 3;
        const y = Math.round(yOf(p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.fillText(p.toFixed(digits), plotW + 4, y + 3);
      }

      // anchoring zone band
      if (m.zone && m.zone[1] > lo && m.zone[0] < hi) {
        let zk = 0;
        if (m.obs?.length) {
          const hit = m.obs.find(
            (o) => Math.abs(o.top - m.zone![1]) <= (m.zone![1] - m.zone![0]) * 0.5
          );
          if (hit) zk = hit.k;
        }
        const x1 = Math.max(0, xOf(zk) - bw / 2);
        const y1 = yOf(Math.min(m.zone[1], hi));
        const y2 = yOf(Math.max(m.zone[0], lo));
        const col = m.zoneKind === "supply" ? "239,68,68" : "34,197,94";
        ctx.fillStyle = `rgba(${col},0.13)`;
        ctx.fillRect(x1, y1, plotW - x1, y2 - y1);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = `rgba(${col},0.6)`;
        ctx.strokeRect(x1 + 0.5, y1 + 0.5, plotW - x1 - 1, y2 - y1 - 1);
        ctx.setLineDash([]);
        if (y2 - y1 > 10) {
          ctx.fillStyle = `rgba(${col},0.95)`;
          ctx.fillText(m.zoneKind === "supply" ? "SUPPLY" : "DEMAND", x1 + 3, y1 + 9);
        }
      }

      // BOS / CHoCH markers
      for (const ev of m.events ?? []) {
        if (ev.k < 0 || ev.k >= N) continue;
        const p = ev.price;
        if (p < lo || p > hi) continue;
        const col = ev.dir === "bullish" ? UP : DOWN;
        ctx.strokeStyle = col;
        ctx.setLineDash([3, 3]);
        const x1 = Math.max(0, xOf(Math.max(ev.k - 10, 0)));
        ctx.beginPath();
        ctx.moveTo(x1, Math.round(yOf(p)) + 0.5);
        ctx.lineTo(xOf(ev.k), Math.round(yOf(p)) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = col;
        ctx.fillText(`${ev.type}${ev.dir === "bullish" ? "↑" : "↓"}`, xOf(ev.k) + 2, yOf(p) - 3);
      }

      // candles
      for (let i = 0; i < N; i++) {
        const b = bars[i];
        const x = xOf(i);
        const col = b.c >= b.o ? UP : DOWN;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yOf(b.h));
        ctx.lineTo(Math.round(x) + 0.5, yOf(b.l));
        ctx.stroke();
        const yO = yOf(b.o);
        const yC = yOf(b.c);
        ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1.1, Math.abs(yC - yO)));
      }

      // realized path for exits (close line from the entry bar)
      if (signal === "EXIT" && m.entryK != null && m.entryK >= 0 && m.entryK < N - 1) {
        ctx.strokeStyle = "rgba(232,234,237,0.55)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let i = m.entryK; i < N; i++) {
          const x = xOf(i);
          const y = yOf(bars[i].c);
          if (i === m.entryK) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        // entry marker
        const xe = Math.round(xOf(m.entryK)) + 0.5;
        ctx.strokeStyle = "rgba(232,234,237,0.7)";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xe, padT);
        ctx.lineTo(xe, priceBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ENTRY;
        ctx.fillText("ENTRY", Math.min(xe + 3, plotW - 30), padT + 8);
      }

      // level lines + labels
      const usedY: number[] = [];
      const styleFor = (tag: string): { col: string; dash: number[] } => {
        if (tag === "SL") return { col: DOWN, dash: [4, 3] };
        if (tag === "TP1") return { col: UP, dash: [4, 3] };
        if (tag === "TP2") return { col: AMBER, dash: [4, 3] };
        if (tag === "EXIT")
          return outcome === "win" || outcome === "loss"
            ? { col: outcome === "win" ? UP : DOWN, dash: [] }
            : { col: TEXT, dash: [2, 3] };
        return { col: ENTRY, dash: [] };
      };
      for (const [p, tag] of levels) {
        if (p < lo || p > hi) continue;
        const y = Math.round(yOf(p)) + 0.5;
        const { col, dash } = styleFor(tag);
        ctx.strokeStyle = col;
        ctx.setLineDash(dash);
        ctx.lineWidth = tag === "EXIT" ? 1.4 : 1.1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        let ly = y;
        while (usedY.some((u) => Math.abs(u - ly) < 12) && ly < priceBottom - 10) ly += 12;
        usedY.push(ly);
        ctx.fillStyle = col;
        ctx.fillRect(plotW + 1, ly - 6, padR - 2, 12);
        ctx.fillStyle = BG_DARK;
        ctx.fillText(tag, plotW + 4, ly + 3);
      }

      // projected path toward TP1 for fresh entries
      if ((signal === "BUY" || signal === "SELL") && m.tp1 != null && near(m.tp1)) {
        const col = signal === "BUY" ? UP : DOWN;
        const x1 = xOf(N - 1);
        const y1 = yOf(bars[N - 1].c);
        const x2 = plotW - 3;
        const y2 = yOf(m.tp1);
        ctx.strokeStyle = col;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - (signal === "BUY" ? -8 : 8), x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        // arrowhead
        const ang = Math.atan2(y2 - (y1 + y2) / 2, x2 - (x1 + x2) / 2);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 6 * Math.cos(ang - 0.4), y2 - 6 * Math.sin(ang - 0.4));
        ctx.lineTo(x2 - 6 * Math.cos(ang + 0.4), y2 - 6 * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fill();
      }

      /* volume delta pane */
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(volTop - 2.5) + 0.5);
      ctx.lineTo(plotW, Math.round(volTop - 2.5) + 0.5);
      ctx.stroke();
      let maxD = 0;
      const deltas = chart.flow.map((f) => f.buy - f.sell);
      for (const dlt of deltas) maxD = Math.max(maxD, Math.abs(dlt));
      if (maxD > 0) {
        const mid = volTop + volH / 2;
        const half = volH / 2 - 2;
        for (let i = 0; i < deltas.length; i++) {
          const x = xOf(i);
          const hgt = (Math.abs(deltas[i]) / maxD) * half;
          ctx.fillStyle = deltas[i] >= 0 ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)";
          if (deltas[i] >= 0) ctx.fillRect(x - bw / 2, mid - hgt, bw, Math.max(hgt, 0.6));
          else ctx.fillRect(x - bw / 2, mid, bw, Math.max(hgt, 0.6));
        }
        ctx.strokeStyle = "rgba(124,134,152,0.25)";
        ctx.beginPath();
        ctx.moveTo(0, Math.round(mid) + 0.5);
        ctx.lineTo(plotW, Math.round(mid) + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = TEXT;
      ctx.fillText("Δ VOL", 3, volTop + 9);

      // header chip
      ctx.fillStyle = "rgba(11,14,17,0.8)";
      ctx.fillRect(2, 2, 92, 15);
      ctx.fillStyle = TEXT;
      ctx.fillText(`${chart.timeframe.toUpperCase()} · ${N} bars`, 7, 13);
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [chart, signal, outcome, digits, height]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-lg border border-border/60 bg-[#0b0e11]"
      role="img"
      aria-label="AI decision sketch: candles with entry, stop, targets, structure and volume delta"
    >
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  );
}

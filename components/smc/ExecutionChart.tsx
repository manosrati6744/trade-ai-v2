"use client";

/**
 * ExecutionChart — the TradingView chart the user can actually trade on.
 *
 * Powered by TradingView's official open-source charting engine
 * (lightweight-charts, MIT license) — the same candles, crosshair and
 * pan/zoom UX as the TradingView website. On top of the candles it draws,
 * as first-class price lines with axis labels:
 *
 *   - the CONSENSUS position (one direction voted by AI + confluence + DOM
 *     volume + structure + delta): entry (blue), stop (red), TP1/TP2 (green)
 *   - liquidity pools (EQH/EQL) — the targets structure hunts for
 *   - BOS / CHoCH structure markers on the candles that produced them
 *
 * The embedded TV widget (iframe) is cross-origin: it accepts no drawing
 * commands and exposes no price-scale data, so precise position drawing
 * inside it is impossible — this component is the sanctioned way to show
 * "positions ON a TradingView chart".
 */

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, TFAnalysis } from "@/lib/smc/engine";
import type { ConsensusPosition } from "@/lib/smc/consensus";
import { fmtPrice } from "@/lib/smc/snapshot";

interface Props {
  candles: Candle[];
  analysis: TFAnalysis;
  consensus: ConsensusPosition | null;
  digits: number;
  height: number | string;
}

const GRID = "rgba(240, 243, 250, 0.05)";
const BORDER = "rgba(240, 243, 250, 0.15)";

function Chip({
  children,
  cls = "",
  title,
}: {
  children: React.ReactNode;
  cls?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded px-1.5 py-px font-mono text-[9px] font-bold ${cls}`}
    >
      {children}
    </span>
  );
}

export default function ExecutionChart({
  candles,
  analysis,
  consensus,
  digits,
  height,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // mount / recreate (digits changes the price formatter)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "#0b0e11" },
        textColor: "#8b949e",
        fontSize: 11,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: BORDER },
      timeScale: {
        borderColor: BORDER,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: {
        vertLine: { color: "rgba(34,197,94,0.4)", labelBackgroundColor: "#14532d" },
        horzLine: { color: "rgba(34,197,94,0.4)", labelBackgroundColor: "#14532d" },
      },
      localization: { priceFormatter: (p: number) => p.toFixed(digits) },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#4ade80",
      wickDownColor: "#f87171",
      borderVisible: false,
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleRef.current = candle;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(candle, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      markersRef.current = null;
      linesRef.current = [];
    };
  }, [digits]);

  // candle + volume data
  useEffect(() => {
    const c = candleRef.current;
    const v = volRef.current;
    if (!c || !v || candles.length === 0) return;
    c.setData(
      candles.map((k) => ({
        time: k.t as UTCTimestamp,
        open: k.o,
        high: k.h,
        low: k.l,
        close: k.c,
      }))
    );
    v.setData(
      candles.map((k) => ({
        time: k.t as UTCTimestamp,
        value: k.v,
        color: k.c >= k.o ? "rgba(34,197,94,0.45)" : "rgba(239,68,68,0.45)",
      }))
    );
  }, [candles]);

  // consensus price lines + liquidity pools + structure markers
  useEffect(() => {
    const c = candleRef.current;
    if (!c) return;
    for (const l of linesRef.current) c.removePriceLine(l);
    linesRef.current = [];
    const add = (
      price: number,
      color: string,
      title: string,
      style: LineStyle,
      width: 1 | 2,
      axisLabel = true
    ) => {
      linesRef.current.push(
        c.createPriceLine({
          price,
          color,
          title,
          lineStyle: style,
          lineWidth: width,
          axisLabelVisible: axisLabel,
        })
      );
    };

    const pos = consensus;
    if (pos && pos.dir !== "WAIT" && pos.entry != null && pos.stop != null && pos.tp1 != null) {
      add(pos.entry, "#3b82f6", `ورود ${fmtPrice(pos.entry, digits)}`, LineStyle.Solid, 2);
      add(pos.stop, "#ef4444", `استاپ ${fmtPrice(pos.stop, digits)}`, LineStyle.Solid, 2);
      add(pos.tp1, "#22c55e", `هدف۱ ${fmtPrice(pos.tp1, digits)}`, LineStyle.Dashed, 2);
      if (pos.tp2 != null)
        add(pos.tp2, "#f59e0b", `هدف۲ ${fmtPrice(pos.tp2, digits)}`, LineStyle.Dashed, 2);
    }
    // liquidity pools the structure aims at (dimmer, no axis clutter)
    for (const l of analysis.liquidity.slice(0, 6)) {
      add(
        l.price,
        l.kind === "EQH" ? "rgba(244,114,182,0.75)" : "rgba(56,189,248,0.75)",
        `${l.kind} ×${l.count}`,
        LineStyle.Dotted,
        1,
        false
      );
    }

    const minT = candles.length ? candles[0].t : 0;
    const markers: SeriesMarker<Time>[] = analysis.events
      .filter((e) => e.t >= minT)
      .slice(-8)
      .map((e) => ({
        time: e.t as UTCTimestamp,
        position: e.dir === "bullish" ? "belowBar" : "aboveBar",
        color: e.dir === "bullish" ? "#22c55e" : "#ef4444",
        shape: e.dir === "bullish" ? "arrowUp" : "arrowDown",
        text: e.type,
      }));
    markersRef.current?.setMarkers(markers);
  }, [consensus, analysis, digits, candles]);

  const dirFa =
    consensus?.dir === "LONG" ? "خرید" : consensus?.dir === "SHORT" ? "فروش" : "انتظار";
  const dirCls =
    consensus?.dir === "LONG"
      ? "bg-emerald-500 text-emerald-950"
      : consensus?.dir === "SHORT"
        ? "bg-red-500 text-red-950"
        : "bg-amber-500 text-amber-950";

  return (
    <div className="w-full" aria-label="چارت اجرا — موتور چارت تریدینگ‌ویو با خطوط پوزیشن">
      {/* consensus strip — the one position all modules voted on */}
      <div
        className="mb-1 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-secondary/40 px-2 py-1.5"
        dir="rtl"
      >
        <span className="text-[9px] font-black text-muted-foreground">
          🎯 پوزیشن اجماع سیستم
        </span>
        {consensus && (
          <>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${dirCls}`}>
              {dirFa} {Math.abs(consensus.score)}%
            </span>
            <span className="flex flex-wrap gap-0.5">
              {consensus.votes.map((vt) => (
                <Chip
                  key={vt.id}
                  title={`${vt.fa} (وزن ${Math.round(vt.weight * 100)}٪): ${vt.detail}`}
                  cls={
                    vt.agree > 0
                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                      : vt.agree < 0
                        ? "bg-red-500/15 text-red-300 ring-1 ring-red-500/40"
                        : "bg-card text-muted-foreground ring-1 ring-border"
                  }
                >
                  {vt.fa} {vt.agree > 0 ? "▲" : vt.agree < 0 ? "▼" : "◆"}
                </Chip>
              ))}
            </span>
            {consensus.dir !== "WAIT" && consensus.entry != null ? (
              <span className="flex flex-wrap items-center gap-1" dir="ltr">
                <Chip cls="bg-blue-500/15 text-blue-300">
                  ورود {fmtPrice(consensus.entry, digits)}
                </Chip>
                <Chip cls="bg-red-500/15 text-red-300">
                  استاپ {fmtPrice(consensus.stop, digits)}
                </Chip>
                <Chip cls="bg-emerald-500/15 text-emerald-300">
                  هدف۱ {fmtPrice(consensus.tp1, digits)}
                </Chip>
                {consensus.tp2 != null && (
                  <Chip cls="bg-amber-500/15 text-amber-300">
                    هدف۲ {fmtPrice(consensus.tp2, digits)}
                  </Chip>
                )}
                {consensus.rr1 != null && (
                  <Chip cls="bg-secondary text-muted-foreground">RR {consensus.rr1}</Chip>
                )}
              </span>
            ) : (
              <span className="text-[9px] leading-3 text-muted-foreground">
                ماژول‌ها هم‌جهت نیستند — بدون ستاپ معتبر
              </span>
            )}
            <span className="text-[8px] text-muted-foreground/80">· {consensus.source}</span>
          </>
        )}
      </div>

      <div
        ref={wrapRef}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-[#0b0e11]"
      />
      <p className="mt-1 px-1 text-[9px] leading-3 text-muted-foreground">
        خط آبی = ورود · قرمز = استاپ · سبز/کهربایی = اهداف · نقطه‌چین = نقدینگی (EQH/EQL) ·
        فلش‌ها = BOS/CHoCH — موتور چارت رسمی تریدینگ‌ویو (Lightweight Charts)
      </p>
    </div>
  );
}

"use client";

import type { Signal, TFAnalysis } from "@/lib/smc/engine";
import { TF_IDS, TF_LABEL } from "@/lib/smc/symbols";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  combined: { score: number; signal: Signal };
  analysis: TFAnalysis | undefined;
  all: Record<string, TFAnalysis>;
  digits: number;
}

const SIGNAL_STYLE: Record<Signal, string> = {
  "STRONG BUY": "bg-emerald-500 text-emerald-950 shadow-[0_0_24px_rgba(34,197,94,0.45)]",
  BUY: "border border-emerald-500 text-emerald-400 bg-emerald-500/10",
  NEUTRAL: "border border-zinc-600 text-zinc-400 bg-zinc-500/10",
  SELL: "border border-red-500 text-red-400 bg-red-500/10",
  "STRONG SELL": "bg-red-500 text-red-950 shadow-[0_0_24px_rgba(239,68,68,0.45)]",
};

const SHORT: Record<Signal, string> = {
  "STRONG BUY": "S.BUY",
  BUY: "BUY",
  NEUTRAL: "NEUT",
  SELL: "SELL",
  "STRONG SELL": "S.SELL",
};

const CHIP: Record<Signal, string> = {
  "STRONG BUY": "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50",
  BUY: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30",
  NEUTRAL: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/30",
  SELL: "bg-red-500/10 text-red-400 ring-1 ring-red-500/30",
  "STRONG SELL": "bg-red-500/20 text-red-300 ring-1 ring-red-500/50",
};

export default function SignalCard({ combined, analysis, all, digits }: Props) {
  const panelFs = usePanelFs();
  const strength = Math.round((combined.score + 100) / 2); // 0..100
  const trendTxt =
    analysis == null
      ? "—"
      : analysis.trend === "bullish"
        ? "BULLISH ↑"
        : analysis.trend === "bearish"
          ? "BEARISH ↓"
          : "RANGING →";

  return (
    <CollapsibleCard
      id="signal"
      fs={panelFs.fs}
      pad={4}
      defaultOpen={false}
      title={<h2 className="text-sm font-bold tracking-wide">MARKET SIGNAL</h2>}
      trailing={<FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="MARKET SIGNAL" />}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`inline-flex items-center rounded-lg px-4 py-2 text-lg font-black tracking-wide ${SIGNAL_STYLE[combined.signal]}`}>
            {combined.signal}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Confluence score <span className="font-mono font-bold text-foreground">{combined.score > 0 ? "+" : ""}{combined.score}</span> · structure + OB + pressure + MTF
          </p>
        </div>
        <div className="min-w-[110px] text-right">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground">TREND (SELECTED TF)</div>
          <div
            className={`font-mono text-sm font-bold ${
              analysis?.trend === "bullish"
                ? "text-emerald-400"
                : analysis?.trend === "bearish"
                  ? "text-red-400"
                  : "text-zinc-400"
            }`}
          >
            {trendTxt}
          </div>
        </div>
      </div>

      {/* strength meter */}
      <div className="relative mt-3 h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-red-500 via-zinc-500 to-emerald-500 opacity-40"
          style={{ width: "100%" }}
        />
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
          style={{ left: `${strength}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold tracking-widest text-muted-foreground">
        <span>SELL</span>
        <span>STRENGTH {strength}%</span>
        <span>BUY</span>
      </div>

      {/* last structure event */}
      {analysis?.lastEvent && (
        <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-foreground">
          <span className="font-bold text-muted-foreground">LAST EVENT: </span>
          <span className={`font-bold ${analysis.lastEvent.dir === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
            {analysis.lastEvent.dir === "bullish" ? "Bullish" : "Bearish"} {analysis.lastEvent.type}
          </span>{" "}
          @ {fmtPrice(analysis.lastEvent.price, digits)} · {analysis.barsSinceEvent} bars ago
        </p>
      )}

      {/* MTF chips */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {TF_IDS.map((k) => {
          const a = all[k];
          return (
            <div
              key={k}
              className={`rounded-md px-1 py-1.5 text-center ${CHIP[a?.signal ?? "NEUTRAL"]}`}
            >
              <div className="font-mono text-[10px] font-bold">{TF_LABEL[k]}</div>
              <div className="text-[10px] font-extrabold">{SHORT[a?.signal ?? "NEUTRAL"]}</div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

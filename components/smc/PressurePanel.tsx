"use client";

import type { TFAnalysis } from "@/lib/smc/engine";
import { TF_IDS, TF_LABEL } from "@/lib/smc/symbols";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  active: TFAnalysis | undefined;
  all: Record<string, TFAnalysis>;
  selected: string;
  onSelect: (tf: string) => void;
}

function arrow(score: number) {
  if (score >= 18) return { ch: "▲", cls: "text-emerald-400" };
  if (score <= -18) return { ch: "▼", cls: "text-red-400" };
  return { ch: "●", cls: "text-zinc-500" };
}

export default function PressurePanel({ active, all, selected, onSelect }: Props) {
  const panelFs = usePanelFs();
  if (!active) return null;
  const { buyPct, sellPct, score } = active.pressure;

  return (
    <CollapsibleCard
      id="pressure"
      fs={panelFs.fs}
      pad={4}
      defaultOpen={false}
      title={<h2 className="text-sm font-bold tracking-wide text-foreground">BUY / SELL PRESSURE</h2>}
      trailing={
        <>
          <span
          className={`rounded-md px-2 py-0.5 font-mono text-xs font-bold ${
            score > 0
              ? "bg-emerald-500/15 text-emerald-400"
              : score < 0
                ? "bg-red-500/15 text-red-400"
                : "bg-zinc-500/15 text-zinc-400"
          }`}
        >
          NET {score > 0 ? "+" : ""}
          {score}
        </span>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="BUY / SELL PRESSURE" />
        </>
      }
    >

      {/* DOM-style split bar */}
      <div className="flex h-10 w-full overflow-hidden rounded-lg border border-border">
        <div
          className="flex items-center bg-gradient-to-r from-emerald-600 to-emerald-500/70 px-3 transition-all duration-500"
          style={{ width: `${buyPct}%` }}
        >
          <span className="text-sm font-extrabold text-white drop-shadow">{buyPct}%</span>
        </div>
        <div
          className="flex items-center justify-end bg-gradient-to-l from-red-600 to-red-500/70 px-3 transition-all duration-500"
          style={{ width: `${sellPct}%` }}
        >
          <span className="text-sm font-extrabold text-white drop-shadow">{sellPct}%</span>
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold tracking-widest text-muted-foreground">
        <span className="text-emerald-400">▲ BUYERS</span>
        <span className="text-red-400">SELLERS ▼</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {selected.toUpperCase()} · last 30 candles · recency-weighted (volume-based when available, body/wick model for FX)
      </p>

      {/* Volume flow direction announcement */}
      {active.flow && (
        <div
          className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold ${
            active.flow.direction === "buyers"
              ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30"
              : active.flow.direction === "sellers"
                ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/30"
                : "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/30"
          }`}
        >
          <span>
            VOLUME FLOW: {active.flow.direction.toUpperCase()} · NET {active.flow.share > 0 ? "+" : ""}
            {active.flow.share}%
          </span>
          <span className="font-mono">
            ΣΔ {active.flow.cumDelta > 0 ? "+" : ""}
            {active.flow.cumDelta.toLocaleString("en-US")}
          </span>
        </div>
      )}

      {/* Price-vs-delta divergence warning */}
      {active.flow?.divergence && active.flow.divergence !== "none" && (
        <div className="mt-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold leading-snug text-amber-400 ring-1 ring-amber-500/30">
          ⚠ {active.flow.divergence.toUpperCase()} DIVERGENCE — price and cumulative delta disagree (
          {active.flow.divergence === "bullish"
            ? "sellers being absorbed"
            : "buyers exhausting"}
          )
        </div>
      )}

      {/* Multi-timeframe matrix */}
      <div className="mt-4 border-t border-border pt-3">
        <h3 className="mb-2 text-[11px] font-bold tracking-widest text-muted-foreground">
          PRESSURE MATRIX — ALL TIMEFRAMES
        </h3>
        <div className="space-y-1">
          {TF_IDS.map((k) => {
            const a = all[k];
            if (!a) return null;
            const ar = arrow(a.pressure.score);
            const isSel = k === selected;
            return (
              <button
                key={k}
                onClick={() => onSelect(k)}
                className={`grid w-full grid-cols-[40px_1fr_46px_1fr_46px_30px] items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                  isSel ? "bg-secondary ring-1 ring-ring/40" : "hover:bg-secondary/60"
                }`}
                aria-label={`Show ${k} timeframe`}
              >
                <span className="font-mono text-xs font-bold text-foreground">{TF_LABEL[k]}</span>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                    style={{ width: `${a.pressure.buyPct}%` }}
                  />
                </div>
                <span className="text-right font-mono text-xs font-bold text-emerald-400">
                  {a.pressure.buyPct}%
                </span>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-400 to-red-600 transition-all duration-500"
                    style={{ width: `${a.pressure.sellPct}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-bold text-red-400">
                  {a.pressure.sellPct}%
                </span>
                <span
                  className={`text-center font-mono text-[10px] font-bold ${
                    a.flow?.direction === "buyers"
                      ? "text-emerald-400"
                      : a.flow?.direction === "sellers"
                        ? "text-red-400"
                        : "text-zinc-500"
                  }`}
                  title={`Volume flow: ${a.flow?.direction ?? "—"} · net ${a.flow?.share ?? 0}%`}
                >
                  {a.flow ? `${a.flow.share > 0 ? "+" : ""}${Math.round(a.flow.share)}` : "—"}
                </span>
                <span className={`text-center text-xs ${ar.cls}`}>{ar.ch}</span>
              </button>
            );
          })}
        </div>
      </div>
    </CollapsibleCard>
  );
}

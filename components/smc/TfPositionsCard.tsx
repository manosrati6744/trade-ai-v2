"use client";

/**
 * TfPositionsCard — a resolved position for EVERY timeframe.
 *
 * The unified theory gives one system-wide position; this card answers the
 * per-timeframe question: what does each of the 6 timeframes' own structure
 * (scenario plans anchored to OB/FVG + liquidity) say right now — direction,
 * entry/stop/TP1/TP2, RR, zone status and the one-line Persian reason.
 * Clicking a row selects that timeframe everywhere.
 */

import { Clock, MousePointerClick } from "lucide-react";
import type { TFAnalysis } from "@/lib/smc/engine";
import { buildTfPositions, type TfPosition } from "@/lib/smc/tfpositions";
import { fmtPrice } from "@/lib/smc/snapshot";
import { TF_IDS, TF_LABEL } from "@/lib/smc/symbols";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  tfs: Record<string, TFAnalysis>;
  digits: number;
  selected: string;
  onSelect: (tf: string) => void;
}

const DIR_CLS: Record<TfPosition["dir"], { chip: string; fa: string }> = {
  LONG: { chip: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50", fa: "خرید ▲" },
  SHORT: { chip: "bg-red-500/20 text-red-300 ring-1 ring-red-400/50", fa: "فروش ▼" },
  WAIT: { chip: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40", fa: "انتظار ◆" },
};

const STATUS_FA: Record<NonNullable<TfPosition["status"]>, string> = {
  "in-zone": "داخل زون ورود",
  "await-retrace": "انتظار پولبک",
  "no-setup": "ست‌آپ ندارد",
};

export default function TfPositionsCard({ tfs, digits, selected, onSelect }: Props) {
  const panelFs = usePanelFs();
  const positions = buildTfPositions(
    Object.fromEntries(TF_IDS.filter((k) => tfs[k]).map((k) => [k, { analysis: tfs[k] }]))
  );
  const actionable = TF_IDS.filter((k) => positions[k]?.dir !== "WAIT").length;

  return (
    <CollapsibleCard
      id="tfpositions"
      fs={panelFs.fs}
      pad={4}
      defaultOpen={false}
      accentCls="border-orange-500/25"
      title={
        <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-wide">
          <Clock className="h-4 w-4 text-orange-400" aria-hidden />
          پوزیشن تایم‌فریم‌ها
        </h2>
      }
      subtitle={
        <span className="hidden font-mono text-[10px] text-muted-foreground xl:inline">
          PER-TIMEFRAME POSITION · OB/FVG + LIQUIDITY ANCHORED
        </span>
      }
      trailing={
        <>
          <span className="rounded-md bg-secondary px-2 py-1 font-mono text-[10px] font-bold text-muted-foreground">
            {actionable}/۶ فعال
          </span>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="tfpositions" />
        </>
      }
    >
      <p className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground" dir="rtl">
        <MousePointerClick className="h-3 w-3" aria-hidden />
        هر تایم‌فریم پوزیشن خودش را دارد — روی هر ردیف بزنید تا همان تایم‌فریم همه‌جا انتخاب شود
      </p>

      <div className="space-y-1.5">
        {TF_IDS.map((k) => {
          const p = positions[k];
          if (!p) return null;
          const dc = DIR_CLS[p.dir];
          const isSel = k === selected;
          return (
            <button
              key={k}
              onClick={() => onSelect(k)}
              aria-pressed={isSel}
              className={`block w-full rounded-xl border p-2.5 text-right transition-colors ${
                isSel ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-border/80 hover:bg-secondary/30"
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-black ${
                    isSel ? "bg-emerald-500 text-emerald-950" : "bg-secondary text-foreground"
                  }`}
                >
                  {TF_LABEL[k]}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${dc.chip}`}>
                  {dc.fa}
                  {p.complete && p.rr1 != null ? ` · RR ${p.rr1}` : ""}
                </span>
                {p.status && p.dir !== "WAIT" && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                    {STATUS_FA[p.status]}
                  </span>
                )}
                {p.complete ? (
                  <span className="mr-auto flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[10.5px] font-bold tabular-nums">
                    <span className="text-muted-foreground">
                      E <span className="text-foreground">{fmtPrice(p.entry, digits)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      SL <span className="text-red-400">{fmtPrice(p.stop, digits)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      TP1 <span className="text-emerald-400">{fmtPrice(p.tp1, digits)}</span>
                    </span>
                    {p.tp2 != null && (
                      <span className="text-muted-foreground">
                        TP2 <span className="text-amber-400">{fmtPrice(p.tp2, digits)}</span>
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="mr-auto text-[10px] text-muted-foreground">سطح معامله‌پذیر ندارد</span>
                )}
              </div>
              <p dir="rtl" className="mt-1 truncate text-[10px] leading-snug text-muted-foreground" title={p.reason}>
                {p.reason}
              </p>
            </button>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

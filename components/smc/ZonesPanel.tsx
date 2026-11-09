"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TFAnalysis } from "@/lib/smc/engine";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  analysis: TFAnalysis | undefined;
  digits: number;
  price: number;
}

const STATE_STYLE = {
  fresh: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40",
  tapped: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40",
  mitigated: "bg-zinc-600/20 text-zinc-500 ring-1 ring-zinc-600/40",
} as const;

function dist(p: number, price: number) {
  if (!price) return "—";
  const d = ((p - price) / price) * 100;
  return `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;
}

export default function ZonesPanel({ analysis, digits, price }: Props) {
  const panelFs = usePanelFs();
  if (!analysis) return null;
  const obs = [...analysis.orderBlocks].sort((a, b) => {
    const w = { fresh: 0, tapped: 1, mitigated: 2 } as const;
    return w[a.state] - w[b.state];
  });

  return (
    <CollapsibleCard
      id="zones"
      fs={panelFs.fs}
      pad={4}
      defaultOpen={false}
      title={<h2 className="text-sm font-bold tracking-wide">SMART MONEY ZONES</h2>}
      trailing={<FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="SMART MONEY ZONES" />}
    >
      <Tabs defaultValue="ob">
        <TabsList className="mb-3 grid w-full grid-cols-3 bg-secondary/60">
          <TabsTrigger value="ob" className="text-xs font-bold">
            ORDER BLOCKS ({obs.filter((o) => o.state !== "mitigated").length})
          </TabsTrigger>
          <TabsTrigger value="fvg" className="text-xs font-bold">
            FVG ({analysis.fvgs.length})
          </TabsTrigger>
          <TabsTrigger value="liq" className="text-xs font-bold">
            LIQUIDITY ({analysis.liquidity.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ob" className="mt-0 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {obs.length === 0 && <Empty text="No order blocks yet" />}
          {obs.map((ob, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                ob.state === "mitigated" ? "border-border/40 opacity-50" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${ob.kind === "demand" ? "bg-emerald-500" : "bg-red-500"}`}
                  aria-hidden
                />
                <div>
                  <div className="text-xs font-bold">
                    {ob.kind === "demand" ? "DEMAND" : "SUPPLY"}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {fmtPrice(ob.bottom, digits)} – {fmtPrice(ob.top, digits)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {dist(ob.kind === "demand" ? ob.top : ob.bottom, price)}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATE_STYLE[ob.state]}`}>
                  {ob.state}
                </span>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="fvg" className="mt-0 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {analysis.fvgs.length === 0 && <Empty text="No open fair value gaps" />}
          {analysis.fvgs.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-sm ${f.kind === "bullish" ? "bg-amber-400" : "bg-orange-400"}`}
                  aria-hidden
                />
                <div>
                  <div className="text-xs font-bold">
                    {f.kind === "bullish" ? "BULLISH FVG" : "BEARISH FVG"}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {fmtPrice(f.bottom, digits)} – {fmtPrice(f.top, digits)}
                  </div>
                </div>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                {dist((f.top + f.bottom) / 2, price)}
              </span>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="liq" className="mt-0 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {analysis.liquidity.length === 0 && <Empty text="No equal highs/lows detected" />}
          {analysis.liquidity
            .slice()
            .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
            .map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-400 ring-1 ring-amber-500/40">
                    {l.kind} ×{l.count}
                  </span>
                  <span className="font-mono text-xs font-bold">{fmtPrice(l.price, digits)}</span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {l.price > price ? "↑ above" : "↓ below"} {dist(l.price, price)}
                </span>
              </div>
            ))}
        </TabsContent>
      </Tabs>
    </CollapsibleCard>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

"use client";

import type { TradePlan } from "@/lib/smc/engine";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  plan: TradePlan | undefined;
  digits: number;
}

const STATUS_STYLE = {
  "in-zone": { label: "● IN ZONE NOW", cls: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40 animate-pulse" },
  "await-retrace": { label: "AWAITING RETRACE", cls: "bg-zinc-500/10 text-zinc-300 ring-1 ring-zinc-500/40" },
  "no-setup": { label: "NO SETUP", cls: "bg-zinc-500/10 text-zinc-500 ring-1 ring-zinc-600/40" },
} as const;

export default function TradePlanCard({ plan, digits }: Props) {
  const panelFs = usePanelFs();
  if (!plan) return null;
  const sideCls =
    plan.side === "LONG"
      ? "bg-emerald-500 text-emerald-950 shadow-[0_0_18px_rgba(34,197,94,0.4)]"
      : plan.side === "SHORT"
        ? "bg-red-500 text-red-950 shadow-[0_0_18px_rgba(239,68,68,0.4)]"
        : "bg-zinc-700 text-zinc-300";
  const status = STATUS_STYLE[plan.status];

  const rows: Array<[string, string, string]> = [
    ["Entry", plan.entry != null ? fmtPrice(plan.entry, digits) : "—", "text-foreground"],
    [
      "Entry Zone",
      plan.entryZone ? `${fmtPrice(plan.entryZone[0], digits)} – ${fmtPrice(plan.entryZone[1], digits)}` : "—",
      "text-foreground",
    ],
    ["Stop Loss", plan.stop != null ? fmtPrice(plan.stop, digits) : "—", "text-red-400"],
    ["Take Profit 1", plan.tp1 != null ? fmtPrice(plan.tp1, digits) : "—", "text-emerald-400"],
    ["Take Profit 2", plan.tp2 != null ? fmtPrice(plan.tp2, digits) : "—", "text-emerald-300"],
    [
      "Risk : Reward",
      plan.rr1 != null ? `1 : ${plan.rr1}  →  1 : ${plan.rr2 ?? "—"}` : "—",
      "text-amber-400",
    ],
  ];

  return (
    <CollapsibleCard
      id="tradeplan"
      fs={panelFs.fs}
      pad={4}
      defaultOpen={false}
      title={<h2 className="text-sm font-bold tracking-wide">TRADE PLAN</h2>}
      trailing={
        <>
          <span className={`rounded-md px-3 py-1 text-sm font-black tracking-wide ${sideCls}`}>
            {plan.side}
          </span>
          <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${status.cls}`}>
            {status.label}
          </span>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="TRADE PLAN" />
        </>
      }
    >

      <div className="grid grid-cols-2 gap-2">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="rounded-lg bg-secondary/50 px-3 py-2">
            <div className="text-[10px] font-bold tracking-wider text-muted-foreground">{k.toUpperCase()}</div>
            <div className={`font-mono text-sm font-bold ${cls}`}>{v}</div>
          </div>
        ))}
      </div>

      <ul className="mt-3 space-y-1">
        {plan.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            {r}
          </li>
        ))}
      </ul>
    </CollapsibleCard>
  );
}

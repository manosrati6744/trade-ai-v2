"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, Target, ShieldAlert, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtPrice } from "@/lib/smc/snapshot";
import type { AIVerdict, AIResponse } from "@/lib/smc/ai-types";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

type AIStats = AIResponse["brain"];

const SIGNAL_STYLE: Record<AIVerdict["signal"], { box: string; text: string; bar: string }> = {
  BUY: { box: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/50", text: "text-emerald-400", bar: "bg-emerald-500" },
  SELL: { box: "bg-red-500/15 text-red-400 ring-1 ring-red-500/50", text: "text-red-400", bar: "bg-red-500" },
  WAIT: { box: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/50", text: "text-amber-400", bar: "bg-amber-500" },
};

export default function AISniperCard({ symbolId, digits }: { symbolId: string; digits: number }) {
  const [data, setData] = useState<AIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ago, setAgo] = useState(0);
  const prevSignal = useRef<string | null>(null);
  const { toast } = useToast();
  const panelFs = usePanelFs();

  const load = useCallback(
    async (sym: string, showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/ai?symbol=${sym}`, { cache: "no-store" });
        const j = (await res.json()) as AIResponse;
        if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
        setData(j);
      } catch {
        /* keep previous verdict visible */
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    prevSignal.current = null;
    setData(null);
    void load(symbolId, true);
  }, [symbolId, load]);

  useEffect(() => {
    const id = setInterval(() => void load(symbolId), 120_000);
    return () => clearInterval(id);
  }, [symbolId, load]);

  useEffect(() => {
    const id = setInterval(() => {
      setAgo(data ? Math.round((Date.now() - data.generatedAt) / 1000) : 0);
    }, 5000);
    return () => clearInterval(id);
  }, [data]);

  // signal-flip alert
  useEffect(() => {
    const v = data?.verdict;
    if (!v) return;
    if (prevSignal.current && prevSignal.current !== v.signal) {
      toast({
        title: `🤖 ربات سیگنال را عوض کرد: ${v.signal}`,
        description: `اطمینان ${v.confidence}٪ · ${v.timeframe.toUpperCase()} · ورود ${fmtPrice(v.entry, digits)}`,
      });
    }
    prevSignal.current = v.signal;
  }, [data, toast, digits]);

  const v = data?.verdict;
  const style = v ? SIGNAL_STYLE[v.signal] : null;

  return (
    <CollapsibleCard
      id="aisniper"
      fs={panelFs.fs}
      accentCls="border-emerald-500/30"
      defaultOpen
      title={
        <>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <Bot className="h-4 w-4 text-emerald-400" aria-hidden />
          </div>
          <h2 className="text-sm font-black tracking-wide">AI SNIPER</h2>
          {data && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">
              BRAIN v{data.brain.version}
            </span>
          )}
        </>
      }
      trailing={
        <>
          {data && (
            <span className="font-mono text-[9px] text-muted-foreground">
              {data.brain.accuracy == null
                ? `${data.brain.open} open`
                : `${data.brain.accuracy}% WR · ${data.brain.tracked}↗`}
            </span>
          )}
          <button
            onClick={() => void load(symbolId, true)}
            aria-label="Refresh AI analysis"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          </button>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="AI SNIPER" />
        </>
      }
    >

      {!v && loading && (
        <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> هوش مصنوعی در حال خواندن بازار…
        </div>
      )}

      {v && style && (
        <>
          {/* verdict row */}
          <div className="flex items-stretch gap-2">
            <div className={`flex min-w-[86px] flex-col items-center justify-center rounded-lg px-3 py-2 ${style.box}`}>
              <Zap className="mb-0.5 h-4 w-4" aria-hidden />
              <span className="text-base font-black leading-none">{v.signal}</span>
            </div>
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  Confidence <b className={style.text}>{v.confidence}%</b> · {v.timeframe.toUpperCase()} · {ago}s ago
                </span>
                <span className={`rounded px-1 py-px font-mono text-[8px] ${data?.engine ? "bg-secondary text-muted-foreground" : "bg-emerald-500/15 text-emerald-400"}`}>
                  {data?.engine ? "ENGINE" : "GLM"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full rounded-full ${style.bar}`}
                  style={{ width: `${v.confidence}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] font-bold">
                <span className="text-muted-foreground">E</span> {fmtPrice(v.entry, digits)}
                <span className="text-muted-foreground">· SL</span>{" "}
                <span className="text-red-400">{fmtPrice(v.stop, digits)}</span>
                <span className="text-muted-foreground">· TP</span>{" "}
                <span className="text-emerald-400">{fmtPrice(v.tp1, digits)}</span>
                {v.tp2 != null && (
                  <>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-amber-400">{fmtPrice(v.tp2, digits)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* flow read */}
          {v.flowRead && (
            <p dir="auto" className="mt-2 border-l-2 border-emerald-500/50 pl-2 text-[11px] italic leading-snug text-muted-foreground">
              {v.flowRead}
            </p>
          )}

          {/* reasoning */}
          {v.reasoning.length > 0 && (
            <ul className="mt-2 space-y-1">
              {v.reasoning.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-foreground/90">
                  <Target className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500/70" aria-hidden />
                  <span dir="auto">{r}</span>
                </li>
              ))}
            </ul>
          )}

          {/* invalidation */}
          {v.invalidation && (
            <p dir="auto" className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-500/5 px-2 py-1.5 text-[10px] leading-snug text-red-300/90">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {v.invalidation}
            </p>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}

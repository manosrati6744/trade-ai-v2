"use client";

/**
 * SummaryBoard — the "whole system at a glance" table pinned at the top of
 * the page. One row per timeframe: market structure (trend + last BOS/CHoCH),
 * buy/sell pressure bar, DOM volume dominance (which side the weight is on),
 * and the per-TF confluence signal — plus the overall weighted verdict and
 * the SNIPER AI verdict with its entry/SL/TP levels.
 */

import type { Signal, TFAnalysis } from "@/lib/smc/engine";
import type { AIVerdict } from "@/lib/smc/ai-types";
import type { DomData } from "@/hooks/use-dom";
import { TF_IDS, TF_LABEL } from "@/lib/smc/symbols";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  all: Record<string, TFAnalysis>;
  combined: { score: number; signal: Signal };
  ai: AIVerdict | null;
  dom: DomData | null;
  domAll: Record<string, DomData> | null;
  digits: number;
  selectedTf: string;
}

const SIGNAL_FA: Record<Signal, { fa: string; cls: string }> = {
  "STRONG BUY": { fa: "خرید قوی", cls: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/60" },
  BUY: { fa: "خرید", cls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/40" },
  NEUTRAL: { fa: "خنثی", cls: "bg-amber-500/10 text-amber-400 ring-amber-500/40" },
  SELL: { fa: "فروش", cls: "bg-red-500/10 text-red-400 ring-red-500/40" },
  "STRONG SELL": { fa: "فروش قوی", cls: "bg-red-500/20 text-red-300 ring-red-500/60" },
};

const AI_FA: Record<AIVerdict["signal"], { fa: string; cls: string }> = {
  BUY: { fa: "خرید", cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/50" },
  SELL: { fa: "فروش", cls: "bg-red-500/15 text-red-400 ring-1 ring-red-500/50" },
  WAIT: { fa: "انتظار", cls: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/50" },
};

const TREND_FA: Record<TFAnalysis["trend"], { fa: string; cls: string }> = {
  bullish: { fa: "صعودی", cls: "text-emerald-400" },
  bearish: { fa: "نزولی", cls: "text-red-400" },
  ranging: { fa: "خنثی", cls: "text-muted-foreground" },
};

export default function SummaryBoard({ all, combined, ai, dom, domAll, digits, selectedTf }: Props) {
  const panelFs = usePanelFs();

  // aggregate DOM volume weight across all timeframes
  const tfs = TF_IDS.map((k) => all[k]).filter(Boolean) as TFAnalysis[];
  const buyTfs = tfs.filter((a) => a.flow.share > 8).length;
  const sellTfs = tfs.filter((a) => a.flow.share < -8).length;
  const avgShare = tfs.length
    ? Math.round(tfs.reduce((s, a) => s + a.flow.share, 0) / tfs.length)
    : 0;
  const aggSide =
    avgShare > 8 ? "buyers" : avgShare < -8 ? "sellers" : "balanced";
  const aggPct = 50 + Math.abs(avgShare) / 2;

  const combSig = SIGNAL_FA[combined.signal];

  // volume / DOM scale — which side the weight has turned
  const buyT = dom?.buyTotal ?? 0;
  const sellT = dom?.sellTotal ?? 0;
  const tot = buyT + sellT;
  const domBuyPct = tot > 0 ? Math.round((buyT / tot) * 100) : 50;
  const domSide = dom == null ? null : domBuyPct > 52 ? "buy" : domBuyPct < 48 ? "sell" : "balanced";
  const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)));
  const wallSide =
    dom == null ? null : dom.walls.bid.v > dom.walls.ask.v * 1.1
      ? "buy"
      : dom.walls.ask.v > dom.walls.bid.v * 1.1
        ? "sell"
        : "balanced";
  const heavy = (s: string | null) =>
    s === "buy"
      ? { fa: "▲ خرید", cls: "text-emerald-400" }
      : s === "sell"
        ? { fa: "▼ فروش", cls: "text-red-400" }
        : { fa: "◆ متعادل", cls: "text-amber-400" };

  // deep-market ladder rows: one per timeframe (5m/15m/30m/1h/4h), falling
  // back to the single finest-TF book while the tf=all response is loading
  const domOrder = ["5m", "15m", "30m", "1h", "4h"];
  type DomRow = { src: string; buy: string; sell: string; side: string | null; extra: string; title: string };
  const domRows: DomRow[] =
    domAll && domOrder.some((tf) => domAll[tf])
      ? domOrder
          .filter((tf) => domAll[tf])
          .map((tf) => {
            const b = domAll[tf];
            const side = b.imbalance > 4 ? "buy" : b.imbalance < -4 ? "sell" : "balanced";
            return {
              src: `نردبان DOM · ${TF_LABEL[tf] ?? tf}`,
              buy: kfmt(b.buyTotal),
              sell: kfmt(b.sellTotal),
              side,
              extra: ` (${b.imbalance > 0 ? "+" : ""}${b.imbalance}%)`,
              title: `دیپ مارکت ${TF_LABEL[tf] ?? tf} — حجم تخمینی خرید ${b.buyTotal} · فروش ${b.sellTotal} · نامتوازنی ${b.imbalance}%`,
            };
          })
      : [
          {
            src: `نردبان DOM (${dom ? TF_LABEL[dom.timeframe] ?? dom.timeframe : "—"} · حوالی قیمت)`,
            buy: dom ? kfmt(buyT) : "—",
            sell: dom ? kfmt(sellT) : "—",
            side: domSide,
            extra: dom ? ` (${dom.imbalance > 0 ? "+" : ""}${dom.imbalance}%)` : "",
            title: dom
              ? `حجم تخمینی خرید ${buyT} · فروش ${sellT} · نامتوازنی ${dom.imbalance}%`
              : "در حال دریافت دیپ مارکت…",
          },
        ];

  return (
    <CollapsibleCard
      id="summary"
      fs={panelFs.fs}
      accentCls="border-emerald-500/25"
      defaultOpen
      bodyCls=""
      title={
        <h2 className="flex items-center gap-1.5 text-sm font-black tracking-wide">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500/15 font-mono text-[10px] text-emerald-400 ring-1 ring-emerald-500/40">
            Σ
          </span>
          خلاصه کل سیستم
        </h2>
      }
      subtitle={
        <span className="font-mono text-[9px] font-normal text-muted-foreground">ALL TF · DOM · AI</span>
      }
      trailing={<FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="SUMMARY" />}
    >

      {/* overall verdicts strip */}
      <div className="grid grid-cols-2 gap-2 px-2 pb-2">
        <div className="rounded-lg bg-secondary/60 px-2 py-1.5">
          <p className="text-[9px] text-muted-foreground">هم‌راستایی تایم‌فریم‌ها</p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ring-1 ${combSig.cls}`}>
              {combSig.fa}
            </span>
            <span className="font-mono text-[11px] font-bold text-foreground">
              {combined.score > 0 ? "+" : ""}
              {combined.score}
            </span>
          </p>
        </div>
        <div className="rounded-lg bg-secondary/60 px-2 py-1.5">
          <p className="text-[9px] text-muted-foreground">هوش مصنوعی SNIPER</p>
          {ai ? (
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${AI_FA[ai.signal].cls}`}>
                {AI_FA[ai.signal].fa}
              </span>
              <span className="font-mono text-[11px] font-bold text-foreground">{ai.confidence}%</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[10px] font-bold text-muted-foreground">در حال تحلیل…</p>
          )}
        </div>
      </div>

      {/* the table */}
      <div className="overflow-x-auto px-2 pb-1">
        <div className="min-w-[330px]">
          {/* column heads */}
          <div className="grid grid-cols-[38px_1fr_86px_66px_64px] items-center gap-1 px-1.5 pb-1 text-[9px] font-bold text-muted-foreground">
            <span>تایم</span>
            <span>ساختار</span>
            <span>فشار خرید/فروش</span>
            <span>حجم غالب</span>
            <span className="text-center">سیگنال</span>
          </div>

          {TF_IDS.map((k) => {
            const a = all[k];
            if (!a) return null;
            const sig = SIGNAL_FA[a.signal];
            const tr = TREND_FA[a.trend];
            const ev = a.lastEvent;
            const dom = a.pressure.buyPct >= a.pressure.sellPct ? "buy" : "sell";
            const domPct = Math.max(a.pressure.buyPct, a.pressure.sellPct);
            const flowSide =
              a.flow.share > 8 ? "buy" : a.flow.share < -8 ? "sell" : "balanced";
            const flowPct = 50 + Math.abs(a.flow.share) / 2;
            return (
              <div
                key={k}
                className={`grid grid-cols-[38px_1fr_86px_66px_64px] items-center gap-1 rounded-lg border-t border-border/60 px-1.5 py-1.5 ${
                  k === selectedTf ? "bg-emerald-500/5 ring-1 ring-emerald-500/25" : ""
                }`}
              >
                <span className={`font-mono text-[10px] font-black ${k === selectedTf ? "text-emerald-400" : "text-foreground"}`}>
                  {TF_LABEL[k]}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[10px] leading-tight">
                  <span className={tr.cls}>{tr.fa}</span>
                  {ev && (
                    <span
                      className={`rounded px-1 font-mono text-[8px] font-bold ${
                        ev.dir === "bullish"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-red-500/15 text-red-400"
                      }`}
                      title={`${ev.type} @ ${fmtPrice(ev.price, digits)}`}
                    >
                      {ev.type}
                      {ev.dir === "bullish" ? "↑" : "↓"}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1" title={`خرید ${a.pressure.buyPct}% · فروش ${a.pressure.sellPct}%`}>
                  <span className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-red-500/40">
                    <span className="h-full bg-emerald-500" style={{ width: `${a.pressure.buyPct}%` }} />
                  </span>
                  <span className={`w-7 text-right font-mono text-[9px] font-bold ${dom === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                    {domPct}%
                  </span>
                </span>
                <span
                  className={`text-[9px] font-bold ${
                    flowSide === "buy"
                      ? "text-emerald-400"
                      : flowSide === "sell"
                        ? "text-red-400"
                        : "text-amber-400"
                  }`}
                  title={`حجم خرید ${Math.round(a.flow.buyVol)} · حجم فروش ${Math.round(a.flow.sellVol)} · قدرت ${a.flow.strength}%`}
                >
                  {flowSide === "buy" ? `▲ خرید ${Math.round(flowPct)}%` : flowSide === "sell" ? `▼ فروش ${Math.round(flowPct)}%` : "◆ متعادل"}
                </span>
                <span className="text-center">
                  <span className={`inline-block rounded px-1 py-0.5 text-[8px] font-black ring-1 ${sig.cls}`}>
                    {sig.fa}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* volume / depth-market weight table — which side the scale turned */}
      <div className="overflow-x-auto px-2 pb-2">
        <div className="min-w-[330px] rounded-lg bg-secondary/40 px-1.5 py-1.5">
          <p className="flex items-center justify-between pb-1">
            <span className="text-[10px] font-black">⚖️ وزن حجم و دیپ مارکت</span>
            <span className="font-mono text-[8px] text-muted-foreground">VOLUME · DOM · AI</span>
          </p>
          <div className="grid grid-cols-[1fr_58px_58px_78px] items-center gap-1 px-1 pb-0.5 text-[9px] font-bold text-muted-foreground">
            <span>منبع</span>
            <span className="text-center text-emerald-500/80">خرید</span>
            <span className="text-center text-red-500/80">فروش</span>
            <span className="text-center">غالب</span>
          </div>
          {[...domRows,
            {
              src: "دیوار حجمی (بزرگ‌ترین سفارش)",
              buy: dom ? `${fmtPrice(dom.walls.bid.p, digits)} · ${kfmt(dom.walls.bid.v)}` : "—",
              sell: dom ? `${fmtPrice(dom.walls.ask.p, digits)} · ${kfmt(dom.walls.ask.v)}` : "—",
              side: wallSide,
              extra: "",
              title: dom
                ? `دیوار خرید @ ${fmtPrice(dom.walls.bid.p, digits)} · دیوار فروش @ ${fmtPrice(dom.walls.ask.p, digits)}`
                : "در حال دریافت…",
            },
            {
              src: "حجم کندل‌ها (میانگین ۶ تایم‌فریم)",
              buy: `${buyTfs} TF`,
              sell: `${sellTfs} TF`,
              side: aggSide === "buyers" ? "buy" : aggSide === "sellers" ? "sell" : "balanced",
              extra: ` (${Math.round(aggPct)}%)`,
              title: `خریداران در ${buyTfs} تایم‌فریم · فروشندگان در ${sellTfs} تایم‌فریم`,
            },
          ].map((r) => {
            const h = heavy(r.side);
            return (
              <div
                key={r.src}
                title={r.title}
                className="grid grid-cols-[1fr_58px_58px_78px] items-center gap-1 border-t border-border/60 px-1 py-1"
              >
                <span className="truncate text-[9px] leading-tight text-muted-foreground">{r.src}</span>
                <span className="text-center font-mono text-[9px] font-bold text-emerald-400" dir="ltr">
                  {r.buy}
                </span>
                <span className="text-center font-mono text-[9px] font-bold text-red-400" dir="ltr">
                  {r.sell}
                </span>
                <span className={`text-center text-[9px] font-black ${h.cls}`}>
                  {h.fa}
                  {r.side !== "balanced" ? r.extra : ""}
                </span>
              </div>
            );
          })}
          {ai && (
            <p className="border-t border-border/60 px-1 pt-1 text-[9px] leading-4 text-muted-foreground">
              <span className="font-bold text-foreground">خوانش AI از حجم: </span>
              {ai.flowRead}
            </p>
          )}
          {ai && ai.entry != null && (
            <p className="px-1 pt-0.5 text-center font-mono text-[9px] text-muted-foreground" dir="ltr">
              AI: E {fmtPrice(ai.entry, digits)} · SL {fmtPrice(ai.stop, digits)} · TP{" "}
              {fmtPrice(ai.tp1, digits)}
              {ai.tp2 != null ? ` / ${fmtPrice(ai.tp2, digits)}` : ""}
            </p>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

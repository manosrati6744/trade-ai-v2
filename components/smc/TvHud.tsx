"use client";

/**
 * TvHud — the "everything summarized" heads-up display floated over the
 * TradingView chart. Four translucent corner panels (pointer-events-none,
 * so the chart underneath stays fully interactive):
 *
 *   top-left     SNIPER AI verdict + confidence + E/SL/TP1/TP2
 *   top-right    confluence score + per-timeframe signal chips
 *   bottom-left  volume / DOM scale — which side the weight turned
 *   bottom-right both LONG & SHORT positions with entry / SL / TP1 / TP2
 *
 * A small toggle button (top-center) collapses the HUD when the user wants
 * a clean chart; the choice is remembered in localStorage.
 */

import { useState } from "react";
import type { Signal, TFAnalysis, ScenarioPlans } from "@/lib/smc/engine";
import type { AIVerdict } from "@/lib/smc/ai-types";
import type { DomData } from "@/hooks/use-dom";
import type { ConsensusPosition } from "@/lib/smc/consensus";
import { TF_IDS, TF_LABEL } from "@/lib/smc/symbols";
import { fmtPrice } from "@/lib/smc/snapshot";

interface Props {
  ai: AIVerdict | null;
  all: Record<string, TFAnalysis>;
  combined: { score: number; signal: Signal };
  dom: DomData | null;
  plans: ScenarioPlans | null;
  consensus: ConsensusPosition | null;
  digits: number;
  price: number | null;
}

const SIG_FA: Record<Signal, { fa: string; cls: string; dot: string }> = {
  "STRONG BUY": { fa: "خرید قوی", cls: "text-emerald-300", dot: "bg-emerald-400" },
  BUY: { fa: "خرید", cls: "text-emerald-400", dot: "bg-emerald-500" },
  NEUTRAL: { fa: "خنثی", cls: "text-amber-400", dot: "bg-amber-500" },
  SELL: { fa: "فروش", cls: "text-red-400", dot: "bg-red-500" },
  "STRONG SELL": { fa: "فروش قوی", cls: "text-red-300", dot: "bg-red-400" },
};

const PANEL =
  "rounded-lg bg-[#0b0e11]/82 ring-1 ring-border backdrop-blur-sm shadow-lg shadow-black/40";

function Row({
  label,
  value,
  cls = "text-foreground",
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <p className="flex items-baseline justify-between gap-2 leading-4">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <span className={`font-mono text-[10px] font-bold ${cls}`}>{value}</span>
    </p>
  );
}

function PositionCard({
  side,
  plan,
  digits,
  starred,
}: {
  side: "LONG" | "SHORT";
  plan: ScenarioPlans["long"];
  digits: number;
  starred: boolean;
}) {
  const long = side === "LONG";
  return (
    <div
      className={`rounded-md px-1.5 py-1 ring-1 ${
        long ? "bg-emerald-500/10 ring-emerald-500/45" : "bg-red-500/10 ring-red-500/45"
      } ${starred ? "shadow-[0_0_10px_rgba(250,204,21,0.35)] ring-amber-400/70" : ""}`}
      dir="ltr"
    >
      <p className="flex items-center justify-between leading-3">
        <span
          className={`text-[9px] font-black ${long ? "text-emerald-400" : "text-red-400"}`}
        >
          {side === "LONG" ? "▲ BUY / LONG" : "▼ SELL / SHORT"}
        </span>
        <span className="flex items-center gap-1">
          {starred && (
            <span className="rounded bg-amber-500/20 px-1 text-[8px] font-black text-amber-300">
              ★ اجماع
            </span>
          )}
          {plan?.rr1 != null && (
            <span className="font-mono text-[8px] text-muted-foreground">RR {plan.rr1}</span>
          )}
        </span>
      </p>
      {plan && plan.entry != null ? (
        <div className="mt-0.5 space-y-px">
          <Row label="ENTRY" value={fmtPrice(plan.entry, digits)} cls="text-foreground" />
          <Row label="SL" value={fmtPrice(plan.stop, digits)} cls="text-red-400" />
          <Row label="TP1" value={fmtPrice(plan.tp1, digits)} cls="text-emerald-400" />
          <Row label="TP2" value={fmtPrice(plan.tp2, digits)} cls="text-amber-400" />
        </div>
      ) : (
        <p className="mt-0.5 text-[9px] text-muted-foreground" dir="rtl">
          سناریوی معتبر نیست
        </p>
      )}
    </div>
  );
}

export default function TvHud({ ai, all, combined, dom, plans, consensus, digits, price }: Props) {
  // TvHud only renders client-side (after the first snapshot fetch), so a
  // lazy localStorage read is hydration-safe; private mode just gets false
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("tv-hud-hidden") === "1";
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setHidden((h) => {
      try {
        localStorage.setItem("tv-hud-hidden", h ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !h;
    });

  const v = ai;
  const combSig = SIG_FA[combined.signal];

  // volume / DOM scale
  const buyT = dom?.buyTotal ?? 0;
  const sellT = dom?.sellTotal ?? 0;
  const tot = buyT + sellT;
  const buyPct = tot > 0 ? Math.round((buyT / tot) * 100) : 50;
  const heavySide =
    dom == null ? null : buyPct > 52 ? "buy" : buyPct < 48 ? "sell" : "balanced";

  const tfs = TF_IDS.map((k) => all[k]).filter(Boolean) as TFAnalysis[];

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-label="TradingView chart HUD">
      {/* collapse toggle — the only interactive element */}
      <div className="pointer-events-auto absolute inset-x-0 top-11 z-30 flex justify-center">
        <button
          onClick={toggle}
          className="rounded-full bg-[#0b0e11]/85 px-2.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground ring-1 ring-border backdrop-blur-sm hover:text-foreground"
          aria-expanded={!hidden}
        >
          {hidden ? "▲ نمایش سیگنال‌ها (HUD)" : "▼ بستن HUD"}
        </button>
      </div>

      {!hidden && (
        <>
          {/* top-left — SNIPER AI */}
          {v && (
            <div className={`absolute left-2 top-14 w-40 ${PANEL} p-1.5`} dir="rtl">
              <p className="flex items-center justify-between leading-3">
                <span className="text-[9px] font-black text-muted-foreground">🤖 SNIPER AI</span>
                <span
                  className={`rounded px-1 py-0.5 text-[9px] font-black ${
                    v.signal === "BUY"
                      ? "bg-emerald-500 text-emerald-950"
                      : v.signal === "SELL"
                        ? "bg-red-500 text-red-950"
                        : "bg-amber-500 text-amber-950"
                  }`}
                >
                  {v.signal === "BUY" ? "خرید" : v.signal === "SELL" ? "فروش" : "انتظار"}{" "}
                  {v.confidence}%
                </span>
              </p>
              <div className="mt-1 space-y-px" dir="ltr">
                <Row label="ENTRY" value={fmtPrice(v.entry, digits)} />
                <Row label="SL" value={fmtPrice(v.stop, digits)} cls="text-red-400" />
                <Row label="TP1" value={fmtPrice(v.tp1, digits)} cls="text-emerald-400" />
                {v.tp2 != null && (
                  <Row label="TP2" value={fmtPrice(v.tp2, digits)} cls="text-amber-400" />
                )}
              </div>
              <p className="mt-1 text-[9px] font-bold text-muted-foreground" dir="rtl">
                تایم‌فریم: {v.timeframe}
              </p>
            </div>
          )}

          {/* top-right — confluence + per-TF chips */}
          <div className={`absolute right-2 top-14 w-40 ${PANEL} p-1.5`} dir="rtl">
            <p className="flex items-center justify-between leading-3">
              <span className="text-[9px] font-black text-muted-foreground">Σ کنفلوانس کل</span>
              <span className={`font-mono text-[10px] font-black ${combSig.cls}`}>
                {combined.score > 0 ? "+" : ""}
                {combined.score}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap gap-0.5" dir="ltr">
              {tfs.map((a) => {
                const s = SIG_FA[a.signal];
                return (
                  <span
                    key={a.timeframe}
                    className={`flex items-center gap-0.5 rounded bg-secondary/70 px-1 py-0.5 font-mono text-[8px] font-bold ${s.cls}`}
                    title={s.fa}
                  >
                    <span className={`h-1 w-1 rounded-full ${s.dot}`} />
                    {TF_LABEL[a.timeframe] ?? a.timeframe}
                  </span>
                );
              })}
            </div>
            {price != null && (
              <p className="mt-1 text-left font-mono text-[9px] text-muted-foreground" dir="ltr">
                {fmtPrice(price, digits)}
              </p>
            )}
          </div>

          {/* bottom-left — volume / DOM scale */}
          {dom && (
            <div className={`absolute bottom-2 left-2 w-44 ${PANEL} p-1.5`} dir="rtl">
              <p className="flex items-center justify-between leading-3">
                <span className="text-[9px] font-black text-muted-foreground">⚖️ ترازوی حجم DOM</span>
                <span
                  className={`text-[9px] font-black ${
                    heavySide === "buy"
                      ? "text-emerald-400"
                      : heavySide === "sell"
                        ? "text-red-400"
                        : "text-amber-400"
                  }`}
                >
                  {heavySide === "buy"
                    ? `▲ خریداران ${buyPct}%`
                    : heavySide === "sell"
                      ? `▼ فروشندگان ${100 - buyPct}%`
                      : "◆ متعادل"}
                </span>
              </p>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-red-500/50" dir="ltr">
                <span className="h-full bg-emerald-500" style={{ width: `${buyPct}%` }} />
              </div>
              <div className="mt-1 space-y-px" dir="ltr">
                <Row
                  label="BID VOL"
                  value={buyT > 999 ? `${(buyT / 1000).toFixed(1)}K` : String(buyT)}
                  cls="text-emerald-400"
                />
                <Row
                  label="ASK VOL"
                  value={sellT > 999 ? `${(sellT / 1000).toFixed(1)}K` : String(sellT)}
                  cls="text-red-400"
                />
                <Row
                  label="IMBALANCE"
                  value={`${dom.imbalance > 0 ? "+" : ""}${dom.imbalance}%`}
                  cls={dom.imbalance > 8 ? "text-emerald-400" : dom.imbalance < -8 ? "text-red-400" : "text-amber-400"}
                />
              </div>
              <p className="mt-1 text-[9px] leading-3 text-muted-foreground">
                دیوار خرید{" "}
                <span className="font-mono font-bold text-emerald-400" dir="ltr">
                  {fmtPrice(dom.walls.bid.p, digits)}
                </span>{" "}
                · دیوار فروش{" "}
                <span className="font-mono font-bold text-red-400" dir="ltr">
                  {fmtPrice(dom.walls.ask.p, digits)}
                </span>
              </p>
            </div>
          )}

          {/* bottom-right — system consensus + both positions */}
          <div className={`absolute bottom-2 right-2 w-40 space-y-1 ${PANEL} p-1.5`} dir="rtl">
            {consensus && (
              <div>
                <p className="flex items-center justify-between leading-3">
                  <span className="text-[9px] font-black text-muted-foreground">
                    ★ نظریهٔ واحد
                  </span>
                  <span
                    className={`rounded px-1 py-0.5 text-[9px] font-black ${
                      consensus.dir === "LONG"
                        ? "bg-emerald-500 text-emerald-950"
                        : consensus.dir === "SHORT"
                          ? "bg-red-500 text-red-950"
                          : "bg-amber-500 text-amber-950"
                    }`}
                  >
                    {consensus.dir === "LONG"
                      ? "خرید"
                      : consensus.dir === "SHORT"
                        ? "فروش"
                        : "انتظار"}{" "}
                    {Math.abs(consensus.score)}%
                  </span>
                </p>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {consensus.votes.map((vt) => (
                    <span
                      key={vt.id}
                      title={`${vt.fa} (وزن ${Math.round(vt.weight * 100)}٪): ${vt.detail}`}
                      className={`rounded px-1 py-px font-mono text-[8px] font-bold ${
                        vt.agree > 0
                          ? "bg-emerald-500/15 text-emerald-300"
                          : vt.agree < 0
                            ? "bg-red-500/15 text-red-300"
                            : "bg-secondary/60 text-muted-foreground"
                      }`}
                    >
                      {vt.fa} {vt.agree > 0 ? "▲" : vt.agree < 0 ? "▼" : "◆"}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[9px] font-black text-muted-foreground">🎯 پوزیشن‌ها</p>
            <PositionCard
              side="LONG"
              plan={plans?.long ?? null}
              digits={digits}
              starred={consensus?.dir === "LONG"}
            />
            <PositionCard
              side="SHORT"
              plan={plans?.short ?? null}
              digits={digits}
              starred={consensus?.dir === "SHORT"}
            />
          </div>
        </>
      )}
    </div>
  );
}

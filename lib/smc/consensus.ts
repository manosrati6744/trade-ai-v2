/**
 * Unified system theory — ONE verdict out of EVERY analytical module.
 *
 * All seven modules cast a signed vote in [-1..+1] with a weight:
 *   1. SNIPER AI            (0.25) — the model verdict, confidence-scaled
 *   2. MTF confluence       (0.20) — 6-timeframe alignment score
 *   3. Volume / DOM         (0.15) — ladder imbalance + per-candle flow share
 *   4. Market structure     (0.10) — active-TF trend + last BOS/CHoCH
 *   5. Delta divergence     (0.10) — price-vs-cumulative-delta absorption
 *   6. Price action         (0.15) — regime (range fade / channel follow),
 *                                     confirmed breakouts and recent fakeouts
 *   7. SMC zones            (0.05) — the structural scenario plan (OB/FVG +
 *                                     liquidity) and whether price is in-zone
 * The weighted sum decides a single direction, then entry / stop / TP1 / TP2
 * are taken from SNIPER AI when it agrees with that direction, with the
 * structural scenario plan as gap-filler — so the chart always draws exactly
 * one position: what the WHOLE system (AI included) thinks.
 */

import type { TFAnalysis, TradePlan } from "@/lib/smc/engine";
import type { AIVerdict } from "@/lib/smc/ai-types";
import type { DomData } from "@/hooks/use-dom";
import type { PARegime } from "@/lib/smc/priceaction";
import { PA_REGIME_FA as REGIME_FA } from "@/lib/smc/priceaction";

export type ConsensusDir = "LONG" | "SHORT" | "WAIT";

export interface ConsensusVote {
  id: "ai" | "tf" | "dom" | "structure" | "delta" | "pa" | "zones";
  fa: string;
  agree: 1 | 0 | -1;
  weight: number;
  detail: string;
}

export interface ConsensusPosition {
  dir: ConsensusDir;
  /** weighted agreement, -100 (all sell) .. +100 (all buy) */
  score: number;
  votes: ConsensusVote[];
  /** one-line Persian read: direction, score, how many modules agree */
  headline: string;
  /** market regime of the active timeframe (for badges) */
  regime: PARegime | null;
  entry: number | null;
  entryZone: [number, number] | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr1: number | null;
  rr2: number | null;
  status: TradePlan["status"] | null;
  source: string;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const sign = (v: number): 1 | 0 | -1 => (v > 0.08 ? 1 : v < -0.08 ? -1 : 0);

export function computeConsensus(
  combined: { score: number },
  ai: AIVerdict | null,
  dom: DomData | null,
  active: TFAnalysis | null
): ConsensusPosition {
  const votes: ConsensusVote[] = [];

  // 1) SNIPER AI — the single smartest opinion; confidence scales its pull
  const aiVal = ai
    ? (ai.signal === "BUY" ? 1 : ai.signal === "SELL" ? -1 : 0) * (0.5 + ai.confidence / 200)
    : 0;
  votes.push({
    id: "ai",
    fa: "AI",
    agree: sign(aiVal),
    weight: 0.25,
    detail: ai
      ? `${ai.signal === "BUY" ? "خرید" : ai.signal === "SELL" ? "فروش" : "انتظار"} · اطمینان ${ai.confidence}%`
      : "در دسترس نیست",
  });

  // 2) multi-timeframe confluence (weighted across all 6 TFs)
  const tfVal = clamp(combined.score / 100);
  votes.push({
    id: "tf",
    fa: "TF",
    agree: sign(tfVal),
    weight: 0.2,
    detail: `امتیاز هم‌راستایی ۶ تایم‌فریم: ${combined.score > 0 ? "+" : ""}${combined.score}`,
  });

  // 3) live volume — DOM ladder imbalance + per-candle flow share
  const domVal = dom ? clamp(dom.imbalance / 40) : 0;
  const flowVal = active ? clamp(active.flow.share / 40) : 0;
  const domValAvg = (domVal + flowVal) / 2;
  votes.push({
    id: "dom",
    fa: "حجم",
    agree: sign(domValAvg),
    weight: 0.15,
    detail: `DOM ${dom ? `${dom.imbalance > 0 ? "+" : ""}${dom.imbalance}%` : "—"} · جریان ${
      active ? `${active.flow.share > 0 ? "+" : ""}${active.flow.share}%` : "—"
    }`,
  });

  // 4) market structure on the active timeframe (trend + last BOS/CHoCH)
  const stVal = active ? (active.trend === "bullish" ? 1 : active.trend === "bearish" ? -1 : 0) : 0;
  votes.push({
    id: "structure",
    fa: "ساختار",
    agree: sign(stVal),
    weight: 0.1,
    detail: active
      ? `روند ${active.trend === "bullish" ? "صعودی" : active.trend === "bearish" ? "نزولی" : "رنج"}${
          active.lastEvent ? ` · ${active.lastEvent.type} ${active.barsSinceEvent >= 0 ? active.barsSinceEvent : "?"} کندل قبل` : ""
        }`
      : "—",
  });

  // 5) price-vs-cumulative-delta divergence (absorption / exhaustion)
  const dvVal = active
    ? active.flow.divergence === "bullish"
      ? 1
      : active.flow.divergence === "bearish"
        ? -1
        : 0
    : 0;
  votes.push({
    id: "delta",
    fa: "دلتا",
    agree: sign(dvVal),
    weight: 0.1,
    detail: `واگرایی دلتا: ${
      active
        ? active.flow.divergence === "bullish"
          ? "مثبت (جذب فروشندگان)"
          : active.flow.divergence === "bearish"
            ? "منفی (خستگی خریداران)"
            : "ندارد"
        : "—"
    }`,
  });

  // 6) price action — regime + confirmed breakouts + recent fakeouts
  const pa = active?.priceAction ?? null;
  let paVal = 0;
  const paBits: string[] = [];
  if (pa) {
    if (pa.regime === "channel-up" && pa.channel) {
      paVal = clamp(pa.channel.strength / 100) * 0.9;
      paBits.push(`کانال صعودی (قدرت ${pa.channel.strength}٪)`);
    } else if (pa.regime === "channel-down" && pa.channel) {
      paVal = -clamp(pa.channel.strength / 100) * 0.9;
      paBits.push(`کانال نزولی (قدرت ${pa.channel.strength}٪)`);
    } else if (pa.regime === "trend-up") {
      paVal = 0.7;
      paBits.push("روند صعودی تیز");
    } else if (pa.regime === "trend-down") {
      paVal = -0.7;
      paBits.push("روند نزولی تیز");
    } else if (pa.regime === "range" && pa.range) {
      // in a range the boundaries are fade zones: near lo → buy bias, near hi → sell
      paVal = clamp((0.5 - pa.range.pos / 100) * 2.2);
      paBits.push(`رنج · قیمت ${Math.round(pa.range.pos)}٪ داخل سازه`);
    }
    const bo = pa.breakouts[0];
    if (bo && bo.barsAgo <= 3) {
      const push = (bo.confirmed ? 0.35 : 0.15) * (1 - bo.barsAgo / 4);
      paVal += bo.dir === "up" ? push : -push;
      paBits.push(`شکست ${bo.dir === "up" ? "صعودی" : "نزولی"}${bo.confirmed ? " تأییدشده" : ""} ${bo.barsAgo} کندل قبل`);
    }
    const fk = pa.fakeouts[0];
    if (fk && fk.barsAgo <= 3) {
      // a failed move is evidence AGAINST its own direction
      paVal += fk.dir === "up" ? -0.4 * (1 - fk.barsAgo / 4) : 0.4 * (1 - fk.barsAgo / 4);
      paBits.push(`فیک‌شکست ${fk.dir === "up" ? "صعودی" : "نزولی"} (تله) ${fk.barsAgo} کندل قبل`);
    }
    paVal = clamp(paVal);
  }
  votes.push({
    id: "pa",
    fa: "پرایس",
    agree: sign(paVal),
    weight: 0.15,
    detail: paBits.length ? paBits.join(" · ") : "—",
  });

  // 7) SMC zones — the structural scenario plan (OB/FVG + liquidity pools)
  const plan = active?.plan ?? null;
  const zBase = plan?.status === "in-zone" ? 0.8 : 0.5;
  const zVal = plan?.side === "LONG" ? zBase : plan?.side === "SHORT" ? -zBase : 0;
  votes.push({
    id: "zones",
    fa: "زون‌ها",
    agree: sign(zVal),
    weight: 0.05,
    detail: plan
      ? `سناریوی ساختاری ${plan.side === "LONG" ? "خرید" : plan.side === "SHORT" ? "فروش" : "بی‌جهت"}${
          plan.status === "in-zone" ? " · قیمت داخل زون ورود" : ""
        }`
      : "—",
  });

  const wSum = votes.reduce((s, v) => s + v.weight, 0);
  const score = Math.round((votes.reduce((s, v) => s + v.agree * v.weight, 0) / wSum) * 100);
  const dir: ConsensusDir = score >= 18 ? "LONG" : score <= -18 ? "SHORT" : "WAIT";

  const forN = votes.filter((v) => v.agree !== 0 && ((dir === "LONG" && v.agree > 0) || (dir === "SHORT" && v.agree < 0))).length;
  const againstN = votes.filter((v) => v.agree !== 0 && ((dir === "LONG" && v.agree < 0) || (dir === "SHORT" && v.agree > 0))).length;
  const activeN = votes.filter((v) => v.agree !== 0).length;
  const regime = pa?.regime ?? null;

  // levels — AI first when it agrees, structural scenario plan as fallback
  const wantSide: "LONG" | "SHORT" | null = dir === "WAIT" ? null : dir;
  const sidePlan = wantSide ? (wantSide === "LONG" ? active?.plans?.long : active?.plans?.short) ?? null : null;
  // if the per-side scenario is missing, the engine's chosen structural plan
  // still carries levels when it points the same way
  const structPlan =
    sidePlan ?? (plan && plan.side === wantSide && plan.entry != null ? plan : null);
  const aiMatches =
    ai != null &&
    ((wantSide === "LONG" && ai.signal === "BUY") || (wantSide === "SHORT" && ai.signal === "SELL"));
  const aiLevels = aiMatches && ai.entry != null && ai.stop != null && ai.tp1 != null;

  let entry = aiLevels ? ai.entry : (structPlan?.entry ?? null);
  let stop = aiLevels ? ai.stop : (structPlan?.stop ?? null);
  let tp1 = aiLevels ? ai.tp1 : (structPlan?.tp1 ?? null);
  let tp2 = aiLevels ? ai.tp2 : (structPlan?.tp2 ?? null);
  // fill single missing fields from the plan before giving up
  if (structPlan) {
    entry = entry ?? structPlan.entry;
    stop = stop ?? structPlan.stop;
    tp1 = tp1 ?? structPlan.tp1;
    tp2 = tp2 ?? structPlan.tp2;
  }

  let status: TradePlan["status"] | null = structPlan?.status ?? null;
  if (status == null && entry != null && active) {
    status = Math.abs(active.price - entry) <= active.atr * 0.5 ? "in-zone" : "await-retrace";
  }

  const source = aiLevels
    ? structPlan
      ? "سطوح AI + سناریوی ساختاری"
      : "سطوح SNIPER AI"
    : structPlan
      ? "سناریوی ساختاری (OB/FVG + نقدینگی)"
      : "—";

  const complete = entry != null && stop != null && tp1 != null;
  // the headline always reflects the FINAL direction — a setup without
  // tradable levels is a WAIT, whatever the raw vote said
  const finalDir: ConsensusDir = complete ? dir : "WAIT";
  const dirFa = finalDir === "LONG" ? "خرید" : finalDir === "SHORT" ? "فروش" : "انتظار";
  const headline =
    finalDir === "WAIT"
      ? `انتظار ${Math.abs(score)}٪ — ${forN} ماژول موافق / ${againstN} مخالف${
          regime ? ` · ${REGIME_FA[regime]}` : ""
        }`
      : `${dirFa} ${Math.abs(score)}٪ — ${forN} از ${activeN} ماژول فعال هم‌جهت${
          regime ? ` · ${REGIME_FA[regime]}` : ""
        }`;
  let rr1: number | null = null;
  let rr2: number | null = null;
  if (complete && entry != null && stop != null && tp1 != null) {
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      rr1 = Math.round((Math.abs(tp1 - entry) / risk) * 10) / 10;
      rr2 = tp2 != null ? Math.round((Math.abs(tp2 - entry) / risk) * 10) / 10 : null;
    }
  }

  return {
    dir: finalDir,
    score,
    votes,
    headline,
    regime,
    entry: complete ? entry : null,
    entryZone: structPlan?.entryZone ?? null,
    stop: complete ? stop : null,
    tp1: complete ? tp1 : null,
    tp2,
    rr1,
    rr2,
    status,
    source,
  };
}

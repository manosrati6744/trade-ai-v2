/**
 * Per-timeframe resolved position.
 *
 * The dashboard shows ONE unified position (consensus.ts) — but every
 * timeframe carries its own structural scenario. This module resolves, for
 * EACH of the 6 timeframes, the single position that timeframe's analysis
 * supports: direction from the confluence score (falling back to the
 * in-zone scenario when scores are neutral), levels from that timeframe's
 * scenario plans (OB/FVG + liquidity anchored), plus a one-line Persian
 * reason. Used by the "پوزیشن تایم‌فریم‌ها" card and by the AI payload
 * (server imports the same pure function — one source of truth).
 */

import type { TFAnalysis, TradePlan } from "./engine";
import { PA_REGIME_FA } from "./priceaction";

export type TfDir = "LONG" | "SHORT" | "WAIT";

export interface TfPosition {
  dir: TfDir;
  /** all of entry/stop/tp1 resolved — false means WAIT is forced */
  complete: boolean;
  side: TradePlan["side"];
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  entryZone: [number, number] | null;
  rr1: number | null;
  status: TradePlan["status"] | null;
  /** one-line Persian reason — چرایی این پوزیشن */
  reason: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function rrOf(entry: number | null, stop: number | null, tp: number | null): number | null {
  if (entry == null || stop == null || tp == null) return null;
  const risk = Math.abs(entry - stop);
  return risk > 0 ? r1(Math.abs(tp - entry) / risk) : null;
}

/** compact Persian reason built from the timeframe's own modules */
export function tfPositionReason(a: TFAnalysis): string {
  const bits: string[] = [];
  bits.push(
    a.trend === "bullish" ? "روند صعودی" : a.trend === "bearish" ? "روند نزولی" : "بازار رنج"
  );
  if (a.lastEvent) {
    const ago = a.barsSinceEvent >= 0 ? `${a.barsSinceEvent} کندل قبل` : "";
    bits.push(
      `${a.lastEvent.type === "CHoCH" ? "تغییر کاراکتر (CHoCH)" : "شکست ساختار (BOS)"} ${
        a.lastEvent.dir === "bullish" ? "صعودی" : "نزولی"
      }${ago ? ` ${ago}` : ""}`
    );
  }
  bits.push(
    a.flow.direction === "buyers"
      ? `خریداران ${Math.abs(Math.round(a.flow.share))}٪ حجم`
      : a.flow.direction === "sellers"
        ? `فروشندگان ${Math.abs(Math.round(a.flow.share))}٪ حجم`
        : "جریان متعادل"
  );
  const pa = a.priceAction;
  if (pa.regime !== "range" && pa.regime !== "trend-up" && pa.regime !== "trend-down") {
    bits.push(`${PA_REGIME_FA[pa.regime]} (قدرت ${pa.channel?.strength ?? "—"}٪)`);
  } else if (pa.regime.startsWith("trend")) {
    bits.push(PA_REGIME_FA[pa.regime]);
  } else if (pa.range) {
    bits.push(`رنج ${Math.round(pa.range.pos)}٪ داخل سازه`);
  }
  const fk = pa.fakeouts[0];
  if (fk && fk.barsAgo <= 3) {
    bits.push(`⚠ فیک‌شکست ${fk.dir === "up" ? "صعودی" : "نزولی"} ${fk.barsAgo} کندل قبل`);
  }
  return bits.join(" · ");
}

/** resolve ONE position for a single timeframe's analysis */
export function buildTfPosition(a: TFAnalysis): TfPosition {
  const longPlan: TradePlan | null = a.plans?.long ?? (a.plan.side === "LONG" ? a.plan : null);
  const shortPlan: TradePlan | null = a.plans?.short ?? (a.plan.side === "SHORT" ? a.plan : null);

  // direction: confluence score first; a fresh in-zone scenario overrides a
  // neutral score — the zone itself is evidence the market is at a level
  let dir: TfDir = "WAIT";
  if (a.score >= 15) dir = "LONG";
  else if (a.score <= -15) dir = "SHORT";
  else if (longPlan?.status === "in-zone" && longPlan.entry != null) dir = "LONG";
  else if (shortPlan?.status === "in-zone" && shortPlan.entry != null) dir = "SHORT";

  // a recent fakeout AGAINST the direction is a trap warning — stand aside
  const fk = a.priceAction.fakeouts[0];
  if (dir === "LONG" && fk && fk.dir === "up" && fk.barsAgo <= 2) dir = "WAIT";
  if (dir === "SHORT" && fk && fk.dir === "down" && fk.barsAgo <= 2) dir = "WAIT";

  const plan = dir === "LONG" ? longPlan : dir === "SHORT" ? shortPlan : null;
  const entry = plan?.entry ?? null;
  const stop = plan?.stop ?? null;
  const tp1 = plan?.tp1 ?? null;
  const tp2 = plan?.tp2 ?? null;
  const complete = entry != null && stop != null && tp1 != null;
  const finalDir: TfDir = complete ? dir : "WAIT";

  let status = plan?.status ?? null;
  if (status == null && finalDir !== "WAIT" && entry != null) {
    status = Math.abs(a.price - entry) <= a.atr * 0.5 ? "in-zone" : "await-retrace";
  }

  let reason: string;
  if (finalDir === "WAIT") {
    reason = dir === "WAIT" && plan == null
      ? `ست‌آپ ساختاری معتبر ندارد · ${tfPositionReason(a)}`
      : `تلهٔ فیک‌شکست اخیر یا سطوح ناقص — صبر · ${tfPositionReason(a)}`;
  } else {
    reason = tfPositionReason(a);
  }

  return {
    dir: finalDir,
    complete,
    side: plan?.side ?? "WAIT",
    entry,
    stop,
    tp1,
    tp2,
    entryZone: plan?.entryZone ?? null,
    rr1: rrOf(entry, stop, tp1),
    status,
    reason,
  };
}

/** all six timeframes at once */
export function buildTfPositions(
  tfs: Record<string, { analysis: TFAnalysis }>
): Record<string, TfPosition> {
  const out: Record<string, TfPosition> = {};
  for (const [k, snap] of Object.entries(tfs)) out[k] = buildTfPosition(snap.analysis);
  return out;
}

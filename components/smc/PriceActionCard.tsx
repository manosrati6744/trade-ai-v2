"use client";

/**
 * PriceActionCard — market regime (range / channel / trend) with boundary
 * levels, a position gauge, and the latest breakout / fake-breakout reads.
 * Data comes from the SMC engine's priceAction module for the selected TF.
 */

import { Crosshair, TriangleAlert } from "lucide-react";
import type { PARegime, PriceAction } from "@/lib/smc/priceaction";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface Props {
  pa: PriceAction | undefined;
  digits: number;
  tf: string;
}

const REGIME_BADGE: Record<PARegime, { label: string; cls: string }> = {
  range: { label: "رنج", cls: "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/40" },
  "channel-up": { label: "کانال صعودی", cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40" },
  "channel-down": { label: "کانال نزولی", cls: "bg-red-500/15 text-red-400 ring-1 ring-red-500/40" },
  "trend-up": { label: "روند صعودی", cls: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40" },
  "trend-down": { label: "روند نزولی", cls: "bg-red-500/15 text-red-400 ring-1 ring-red-500/40" },
};

function Gauge({ pos, loLabel, hiLabel }: { pos: number; loLabel: string; hiLabel: string }) {
  return (
    <div className="mt-1.5" aria-label={`موقعیت قیمت ${Math.round(pos)}٪ ارتفاع سازه`}>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-500/35 via-zinc-600/30 to-red-500/35">
        <div
          className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_6px_rgba(255,255,255,0.45)]"
          style={{ left: `${Math.min(98, Math.max(2, pos))}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>{loLabel}</span>
        <span className="font-bold text-foreground">{Math.round(pos)}٪</span>
        <span>{hiLabel}</span>
      </div>
    </div>
  );
}

export default function PriceActionCard({ pa, digits, tf }: Props) {
  const panelFs = usePanelFs();
  if (!pa) return null;

  const badge = REGIME_BADGE[pa.regime];
  const gauge =
    pa.range
      ? { pos: pa.range.pos, lo: `کف ${fmtPrice(pa.range.lo, digits)}`, hi: `سقف ${fmtPrice(pa.range.hi, digits)}` }
      : pa.channel
        ? { pos: pa.channel.pos, lo: `کف کانال`, hi: `سقف کانال` }
        : null;

  const rows: Array<[string, string, string]> = [];
  if (pa.range) {
    rows.push(["سقف رنج (مقاومت)", fmtPrice(pa.range.hi, digits), "text-red-400"]);
    rows.push(["کف رنج (حمایت)", fmtPrice(pa.range.lo, digits), "text-emerald-400"]);
    rows.push(["عرض رنج", `${pa.range.widthAtr}×ATR · ${pa.range.widthPct}٪`, "text-foreground"]);
    rows.push(["برخوردها", `${pa.range.hiTouches} سقف / ${pa.range.loTouches} کف`, "text-foreground"]);
    rows.push(["عمر رنج", `${pa.range.bars} کندل داخل مرزها`, "text-foreground"]);
  } else if (pa.channel) {
    rows.push(["سقف کانال", fmtPrice(pa.channel.upper, digits), "text-red-400"]);
    rows.push(["کف کانال", fmtPrice(pa.channel.lower, digits), "text-emerald-400"]);
    rows.push(["شیب / قدرت", `${pa.channel.strength}٪ همبستگی · ${pa.channel.widthAtr}×ATR`, "text-foreground"]);
  }

  return (
    <CollapsibleCard
      id="priceaction"
      fs={panelFs.fs}
      pad={4}
      defaultOpen
      accentCls="border-sky-500/25"
      title={
        <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-wide">
          <Crosshair className="h-4 w-4 text-sky-400" aria-hidden />
          پرایس اکشن · رنج و شکست‌ها
        </h2>
      }
      subtitle={
        <span className="hidden font-mono text-[10px] text-muted-foreground xl:inline">
          {tf} · RANGE / CHANNEL / BREAKOUT / FAKE-BREAKOUT
        </span>
      }
      trailing={
        <>
          <span className={`rounded-md px-2 py-1 text-[11px] font-black ${badge.cls}`}>{badge.label}</span>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="priceaction" />
        </>
      }
    >
      {/* main one-line read */}
      <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-bold leading-relaxed text-sky-200 ring-1 ring-sky-500/25">
        {pa.status}
      </p>

      {gauge && <Gauge pos={gauge.pos} loLabel={gauge.lo} hiLabel={gauge.hi} />}

      {rows.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {rows.map(([k, val, cls], idx) => (
            <div
              key={k}
              className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] ${
                idx % 2 === 0 ? "bg-secondary/40" : ""
              }`}
            >
              <span className="text-muted-foreground">{k}</span>
              <span className={`font-mono font-bold tabular-nums ${cls}`}>{val}</span>
            </div>
          ))}
        </div>
      )}

      {/* breakout / fakeout events */}
      {(pa.breakouts.length > 0 || pa.fakeouts.length > 0) && (
        <div className="mt-3 space-y-1.5">
          {pa.fakeouts.map((f) => (
            <div
              key={`fk-${f.i}-${f.dir}`}
              className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px]"
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
              <span className="font-black text-amber-400">FAKE {f.dir === "up" ? "↑" : "↓"}</span>
              <span className="text-amber-200/90">
                فیک‌شکست {f.dir === "up" ? "صعودی" : "نزولی"} روی {fmtPrice(f.boundary, digits)}
              </span>
              <span className="mr-auto shrink-0 font-mono text-[9px] text-amber-300/70">
                {f.barsAgo === 0 ? "همین کندل" : `${f.barsAgo} کندل قبل`} · {f.wickOnly ? "سایهٔ تله" : "بازگشت داخل"} · قوت {f.strength}٪
              </span>
            </div>
          ))}
          {pa.breakouts.map((b) => (
            <div
              key={`bo-${b.i}-${b.dir}`}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                b.confirmed
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-zinc-500/30 bg-zinc-500/10"
              }`}
            >
              <span className={`font-black ${b.confirmed ? "text-emerald-400" : "text-zinc-300"}`}>
                {b.confirmed ? "BO ✓" : "BO?"} {b.dir === "up" ? "↑" : "↓"}
              </span>
              <span className={b.confirmed ? "text-emerald-200/90" : "text-zinc-300/90"}>
                شکست {b.dir === "up" ? "صعودی" : "نزولی"} {b.source === "range" ? "رنج" : "کانال"} از {fmtPrice(b.boundary, digits)}
              </span>
              <span className="mr-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                {b.barsAgo === 0 ? "همین کندل" : `${b.barsAgo} کندل قبل`} · حجم {b.volumeRatio}× · قوت {b.strength}٪
              </span>
            </div>
          ))}
        </div>
      )}

      {pa.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-2.5">
          {pa.notes.map((nt, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <span className="text-sky-500" aria-hidden>▪</span>
              <span>{nt}</span>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  );
}

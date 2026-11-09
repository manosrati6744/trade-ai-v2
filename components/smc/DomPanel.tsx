"use client";

/**
 * DomPanel — live Depth-of-Market ladder, per timeframe.
 *
 * A vertical bid/ask ladder built from the app's LIVE volume flow (the same
 * estimation model LuxAlgo's DOM uses on TradingView, since exchanges do not
 * publish L2 books for spot gold/oil/FX). Green bars = resting buy interest
 * (bids), red bars = sell interest (asks); the row closest to price is
 * highlighted; biggest walls are flagged; a net imbalance gauge sums it up.
 * The TF chips (5m/15m/30m/1h/4h) rebuild the ladder from that timeframe's
 * candles — each timeframe gets its own book.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Layers, Anchor } from "lucide-react";
import { fmtPrice } from "@/lib/smc/snapshot";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface DomData {
  symbol: string;
  name: string;
  digits: number;
  price: number;
  timeframe: string;
  source: "tradingview" | "yahoo";
  t: number;
  tick: number;
  levels: { p: number; buy: number; sell: number }[];
  imbalance: number;
  buyTotal: number;
  sellTotal: number;
  maxVol: number;
  walls: { bid: { p: number; v: number }; ask: { p: number; v: number } };
  spread: number;
}

const DOM_TFS = ["5m", "15m", "30m", "1h", "4h"] as const;

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export default function DomPanel({ symbolId }: { symbolId: string }) {
  const [activeTf, setActiveTf] = useState<string>("5m");
  const [books, setBooks] = useState<Record<string, DomData>>({});
  const [loading, setLoading] = useState(true);
  const { fs, toggle } = usePanelFs();
  // last successful fetch per tf, for the "Xs ago" readout of the active one
  const updatedAt = useRef<Record<string, number>>({});
  const [ago, setAgo] = useState(0);

  const load = useCallback(async (sym: string, tf: string) => {
    try {
      const res = await fetch(`/api/dom?symbol=${sym}&tf=${tf}`, { cache: "no-store" });
      const j = (await res.json()) as DomData & { error?: string };
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
      setBooks((prev) => ({ ...prev, [tf]: j }));
      updatedAt.current = { ...updatedAt.current, [tf]: Date.now() };
    } catch {
      /* keep previous book visible */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setBooks({});
    updatedAt.current = {};
    void load(symbolId, activeTf);
    const id = setInterval(() => void load(symbolId, activeTf), 10_000); // fast live ladder
    return () => clearInterval(id);
  }, [symbolId, activeTf, load]);

  useEffect(() => {
    const id = setInterval(() => {
      const ts = updatedAt.current[activeTf];
      setAgo(ts ? Math.round((Date.now() - ts) / 1000) : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [activeTf]);

  const data = books[activeTf] ?? null;
  const buyPct =
    data && data.buyTotal + data.sellTotal > 0
      ? Math.round((data.buyTotal / (data.buyTotal + data.sellTotal)) * 100)
      : 50;

  return (
    <CollapsibleCard
      id="dom"
      fs={fs}
      defaultOpen={false}
      title={
        <>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <Layers className="h-4 w-4 text-emerald-400" aria-hidden />
          </div>
          <h2 className="text-sm font-black tracking-wide">DEPTH OF MARKET</h2>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-bold uppercase ${
              data?.source === "tradingview"
                ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40"
                : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${data?.source === "tradingview" ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`}
              aria-hidden
            />
            LIVE · {(data?.timeframe ?? activeTf).toUpperCase()}
          </span>
        </>
      }
      trailing={
        <>
          <span className="font-mono text-[9px] text-muted-foreground">{ago}s ago</span>
          <FsButton fs={fs} onToggle={toggle} label="DOM" />
        </>
      }
    >

      {/* timeframe chips — one book per timeframe */}
      <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="تایم‌فریم دیپ مارکت">
        {DOM_TFS.map((tf) => (
          <button
            key={tf}
            role="tab"
            aria-selected={activeTf === tf}
            onClick={() => setActiveTf(tf)}
            className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-black uppercase transition-colors ${
              activeTf === tf
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/60"
                : "bg-secondary/60 text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
          >
            {tf}
          </button>
        ))}
        <span className="ms-1 text-[9px] text-muted-foreground">نردبان هر تایم‌فریم جدا ساخته می‌شود</span>
      </div>

      {loading && !data && (
        <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> در حال ساخت نردبان زندهٔ حجم…
        </div>
      )}

      {data && (
        <>
          {/* imbalance meter */}
          <div className="mb-1 flex items-center justify-between font-mono text-[10px]">
            <span className="text-emerald-400">BUY VOL {fmtVol(data.buyTotal)}</span>
            <span
              className={`font-black ${data.imbalance > 0 ? "text-emerald-400" : data.imbalance < 0 ? "text-red-400" : "text-zinc-400"}`}
            >
              IMBALANCE {data.imbalance > 0 ? "+" : ""}{data.imbalance}%
            </span>
            <span className="text-red-400">SELL VOL {fmtVol(data.sellTotal)}</span>
          </div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
              style={{ width: `${buyPct}%` }}
            />
            <div
              className="bg-gradient-to-l from-red-600 to-red-400 transition-all duration-500"
              style={{ width: `${100 - buyPct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
            <span>
              TICK {fmtPrice(data.tick, data.digits)} · SPREAD≈ {fmtPrice(data.spread, data.digits)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Anchor className="h-3 w-3 text-amber-400" aria-hidden />
              WALLS · BUY {fmtPrice(data.walls.bid.p, data.digits)} ({fmtVol(data.walls.bid.v)}) · SELL{" "}
              {fmtPrice(data.walls.ask.p, data.digits)} ({fmtVol(data.walls.ask.v)})
            </span>
          </div>

          {/* ladder */}
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[1fr_88px_1fr] bg-secondary/60 px-2 py-1 text-center font-mono text-[9px] font-bold tracking-wider text-muted-foreground">
              <span className="text-emerald-400">BUY VOL</span>
              <span>PRICE</span>
              <span className="text-red-400">SELL VOL</span>
            </div>
            <div className={fs ? "" : "max-h-[330px] overflow-y-auto [scrollbar-width:thin]"}>
              {data.levels.map((l) => {
                const isPriceRow = Math.abs(l.p - data.price) < data.tick / 2;
                const nearWallBid = l.p === data.walls.bid.p && l.buy > 0;
                const nearWallAsk = l.p === data.walls.ask.p && l.sell > 0;
                return (
                  <div
                    key={l.p}
                    className={`grid grid-cols-[1fr_88px_1fr] items-center px-2 ${
                      isPriceRow
                        ? "bg-amber-500/10 ring-1 ring-inset ring-amber-500/50"
                        : "border-t border-border/60"
                    }`}
                    style={{ height: fs ? 30 : 24 }}
                  >
                    {/* bid bar */}
                    <div className="flex h-full items-center justify-start">
                      {l.buy > 0 && (
                        <div
                          className="flex h-3/5 min-w-0 items-center justify-start rounded-l bg-gradient-to-r from-emerald-500/85 to-emerald-500/45 px-1"
                          style={{ width: `${(l.buy / data.maxVol) * 100}%` }}
                        >
                          <span className="truncate font-mono text-[9px] font-bold text-white">
                            {fmtVol(l.buy)}
                            {nearWallBid ? " ⚓" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-center font-mono text-[10px] font-bold tabular-nums ${
                        isPriceRow ? "text-amber-300" : "text-foreground/80"
                      }`}
                    >
                      {fmtPrice(l.p, data.digits)}
                    </span>
                    {/* ask bar */}
                    <div className="flex h-full items-center justify-end">
                      {l.sell > 0 && (
                        <div
                          className="flex h-3/5 min-w-0 items-center justify-end rounded-r bg-gradient-to-l from-red-500/85 to-red-500/45 px-1"
                          style={{ width: `${(l.sell / data.maxVol) * 100}%` }}
                        >
                          <span className="truncate font-mono text-[9px] font-bold text-white">
                            {nearWallAsk ? "⚓ " : ""}
                            {fmtVol(l.sell)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p dir="rtl" className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
            نردبان زنده از جریان حجم لحظه‌ای بازار برآورد می‌شود (مدل LuxAlgo DOM). کتاب سفارش واقعی L2 برای
            طلا/نفت/فارکس منتشر نمی‌شود؛ این تخمین از تیک‌های زندهٔ TradingView است. ⚓ = دیوار حجمی · ردیف طلایی =
            قیمت لحظه‌ای. با چیپ‌های بالای نردبان، کتاب هر تایم‌فریم (۵m تا ۴h) جداگانه ساخته و رصد می‌شود.
          </p>
        </>
      )}
    </CollapsibleCard>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Volume2, VolumeX, Download, Radar, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { combineSignal, type TFAnalysis } from "@/lib/smc/engine";
import { computeConsensus, type ConsensusDir } from "@/lib/smc/consensus";
import { buildTfPositions } from "@/lib/smc/tfpositions";
import { pushLive } from "@/lib/smc/livereport";
import { SYMBOLS, TF_IDS, TF_LABEL, TF_TV_INTERVAL, type TFId } from "@/lib/smc/symbols";
import { fmtPct, fmtPrice, type SnapshotData } from "@/lib/smc/snapshot";
import { PA_REGIME_FA } from "@/lib/smc/priceaction";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import CandleChart from "@/components/smc/CandleChart";
import TvChart from "@/components/smc/TvChart";
import ExecutionChart from "@/components/smc/ExecutionChart";
import DomPanel from "@/components/smc/DomPanel";
import FsButton from "@/components/smc/FsButton";
import { usePanelFs } from "@/hooks/use-panel-fs";
import PressurePanel from "@/components/smc/PressurePanel";
import SignalCard from "@/components/smc/SignalCard";
import SmartMoneyCard from "@/components/smc/SmartMoneyCard";
import TfPositionsCard from "@/components/smc/TfPositionsCard";
import TradePlanCard from "@/components/smc/TradePlanCard";
import AISniperCard from "@/components/smc/AISniperCard";
import AiMessages from "@/components/smc/AiMessages";
import SummaryBoard from "@/components/smc/SummaryBoard";
import PerformancePanel from "@/components/smc/PerformancePanel";
import TelegramCard from "@/components/smc/TelegramCard";
import CollapsibleCard, { setAllCardsOpen } from "@/components/smc/CollapsibleCard";
import TvHud from "@/components/smc/TvHud";
import useDom, { useDomAll } from "@/hooks/use-dom";
import type { AIResponse } from "@/lib/smc/ai-types";

type PrevState = Record<
  string,
  { evKey: string; tappedKeys: string; score: number; paKey: string } | undefined
>;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function beep(ctxRef: { current: AudioContext | null }, on: boolean) {
  if (!on) return;
  try {
    if (!ctxRef.current) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctxRef.current = new AC();
    }
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    [0, 0.2].forEach((d, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = i === 0 ? 740 : 990;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t + d);
      o.stop(t + d + 0.22);
    });
  } catch {
    /* audio unavailable */
  }
}

export default function Home() {
  const [symbolId, setSymbolId] = useState<string>("XAUUSD");
  const [tf, setTf] = useState<TFId>("5m");
  const [data, setData] = useState<SnapshotData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [ago, setAgo] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [chartTab, setChartTab] = useState<"tv" | "exec" | "smc">("tv");
  const [ai, setAi] = useState<AIResponse | null>(null);
  const chartFs = usePanelFs();

  const { toast } = useToast();
  const audioRef = useRef<AudioContext | null>(null);
  const prevRef = useRef<PrevState>({});
  const soundRef = useRef(false);
  soundRef.current = soundOn;

  const load = useCallback(async (sym: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/analysis?symbol=${sym}`, { cache: "no-store" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as SnapshotData;
      setData(j);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    prevRef.current = {};
    void load(symbolId, true);
  }, [symbolId, load]);

  useEffect(() => {
    const id = setInterval(() => void load(symbolId), 30_000);
    return () => clearInterval(id);
  }, [symbolId, load]);

  // shared DOM ladder — feeds the summary weight table and the TV chart HUD
  const dom = useDom(symbolId);
  const domAll = useDomAll(symbolId);

  // shared SNIPER AI verdict — feeds the summary board and the TV chart ribbon
  useEffect(() => {
    let live = true;
    setAi(null);
    const fetchAi = async () => {
      try {
        const res = await fetch(`/api/ai?symbol=${symbolId}`, { cache: "no-store" });
        const j = (await res.json()) as AIResponse;
        if (live && !j.error) setAi(j);
      } catch {
        /* server-side cache keeps this cheap; next poll retries */
      }
    };
    void fetchAi();
    const id = setInterval(fetchAi, 120_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [symbolId]);

  useEffect(() => {
    const id = setInterval(() => {
      setAgo(updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : 0);
    }, 3000);
    return () => clearInterval(id);
  }, [updatedAt]);

  // PWA install prompt
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => setInstallEvt(null));
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // Service worker
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Alerts engine — diff previous vs current snapshot. Toasts cover the
  // selected timeframe; the live Persian report (AI MESSAGES panel) records
  // EVERY timeframe's events so the user gets a moment-to-moment market log.
  useEffect(() => {
    if (!data) return;
    const prev = prevRef.current;
    const cur: PrevState = {};
    for (const [k, snap] of Object.entries(data.tfs)) {
      const a: TFAnalysis = snap.analysis;
      const ev = a.lastEvent;
      const evKey = ev ? `${ev.type}:${ev.dir}:${ev.i}` : "";
      const tappedKeys = a.orderBlocks
        .filter((o) => o.state === "tapped")
        .map((o) => `${o.kind}:${o.i}`)
        .sort()
        .join(",");
      const pa = a.priceAction;
      // newest fakeout/breakout identity — toasts fire only when it changes
      const paNewest = pa.fakeouts[0]
        ? `f:${pa.fakeouts[0].i}:${pa.fakeouts[0].dir}`
        : pa.breakouts[0] && pa.breakouts[0].barsAgo <= 3
          ? `b:${pa.breakouts[0].i}:${pa.breakouts[0].dir}`
          : "";
      cur[k] = { evKey, tappedKeys, score: a.score, paKey: paNewest };
      const p = prev[k];
      if (!p) continue;

      if (ev && evKey !== p.evKey && a.barsSinceEvent >= 0 && a.barsSinceEvent <= 3) {
        const isChoch = ev.type === "CHoCH";
        const dirFa = ev.dir === "bullish" ? "صعودی" : "نزولی";
        toast({
          title: `${TF_LABEL[k]} · ${isChoch ? "⚡ Structure Shift — CHoCH" : "📈 Break of Structure"}`,
          description: `${ev.dir === "bullish" ? "Bullish" : "Bearish"} ${ev.type} @ ${fmtPrice(ev.price, data.digits)}`,
        });
        pushLive(symbolId, {
          id: `st-${symbolId}-${k}-${ev.type}-${ev.dir}-${ev.i}`,
          t: Date.now(),
          kind: "structure",
          tf: TF_LABEL[k],
          text: isChoch
            ? `⚡ تغییر کاراکتر بازار (CHoCH) ${dirFa} — ساختار قبلی شکست`
            : `📈 شکست ساختار (BOS) ${dirFa} — روند تأیید شد`,
          sub: `سطح شکست ${fmtPrice(ev.price, data.digits)} · روند تایم‌فریم: ${
            a.trend === "bullish" ? "صعودی" : a.trend === "bearish" ? "نزولی" : "رنج"
          } · امتیاز هم‌راستایی ${a.score > 0 ? "+" : ""}${a.score}`,
        });
        beep(audioRef, soundRef.current);
      }
      const newTaps = tappedKeys
        .split(",")
        .filter((x) => x && !p.tappedKeys.includes(x));
      if (newTaps.length > 0) {
        const kind = newTaps[0].startsWith("demand") ? "Demand" : "Supply";
        if (k === tf) {
          toast({
            title: `🎯 Price entered ${kind} Order Block`,
            description: `${k.toUpperCase()} timeframe — watch for entry confirmation`,
          });
          beep(audioRef, soundRef.current);
        }
        const ob = a.orderBlocks.find((o) => `${o.kind}:${o.i}` === newTaps[0]);
        pushLive(symbolId, {
          id: `zn-${symbolId}-${k}-${newTaps[0]}`,
          t: Date.now(),
          kind: "zone",
          tf: TF_LABEL[k],
          text: `🎯 قیمت وارد Order Block ${newTaps[0].startsWith("demand") ? "تقاضا (حمایت)" : "عرضه (مقاومت)"} شد`,
          sub: ob
            ? `زون ${fmtPrice(ob.bottom, data.digits)}–${fmtPrice(ob.top, data.digits)} — ${
                newTaps[0].startsWith("demand")
                  ? "واکنش خرید را ببینید؛ کلوز زیر کف زون = ابطال"
                  : "واکنش فروش را ببینید؛ کلوز بالای سقف زون = ابطال"
              }`
            : undefined,
        });
      }
      if (paNewest && paNewest !== p.paKey) {
        const fk = pa.fakeouts[0];
        const isFake = paNewest.startsWith("f:");
        if (k === tf) {
          toast({
            title: isFake
              ? `⚠️ ${TF_LABEL[k]} · فیک‌شکست ${fk?.dir === "up" ? "صعودی" : "نزولی"} — تلهٔ احتمالی`
              : `💥 ${TF_LABEL[k]} · شکست ${pa.breakouts[0]?.dir === "up" ? "صعودی" : "نزولی"} شناسایی شد`,
            description: pa.status,
          });
          beep(audioRef, soundRef.current);
        }
        if (isFake) {
          pushLive(symbolId, {
            id: `fk-${symbolId}-${k}-${paNewest}`,
            t: Date.now(),
            kind: "fakeout",
            tf: TF_LABEL[k],
            text: `⚠️ فیک‌شکست ${fk?.dir === "up" ? "صعودی" : "نزولی"} — تلهٔ احتمالی`,
            sub: `${fk?.wickOnly ? "سایه از مرز زد بیرون و کلوز داخل برگشت" : "کلوز بیرون مرز بود و داخل بازگشت"} · مرز ${fmtPrice(fk?.boundary, data.digits)} · ${pa.status}`,
          });
        } else if (pa.breakouts[0]) {
          const bo = pa.breakouts[0];
          pushLive(symbolId, {
            id: `bo-${symbolId}-${k}-${paNewest}`,
            t: Date.now(),
            kind: "breakout",
            tf: TF_LABEL[k],
            text: `💥 شکست ${bo.dir === "up" ? "صعودی" : "نزولی"} ${bo.source === "range" ? "رنج" : "کانال"}${bo.confirmed ? " (تأییدشده)" : ""}`,
            sub: `مرز ${fmtPrice(bo.boundary, data.digits)} · حجم ${bo.volumeRatio}× میانگین · قوت ${bo.strength}٪ · ${pa.status}`,
          });
        }
      }
      if (Math.abs(a.score) >= 65 && Math.abs(p.score) < 65) {
        toast({
          title: `${TF_LABEL[k]} · ${a.score > 0 ? "🟢 Strong bullish pressure" : "🔴 Strong bearish pressure"}`,
          description: `Confluence score ${a.score > 0 ? "+" : ""}${a.score} (${a.signal})`,
        });
        pushLive(symbolId, {
          id: `pr-${symbolId}-${k}-${a.score}`,
          t: Date.now(),
          kind: "pressure",
          tf: TF_LABEL[k],
          text: a.score > 0 ? "🟢 فشار خرید قوی — امتیاز هم‌راستایی از ۶۵+ عبور کرد" : "🔴 فشار فروش قوی — امتیاز هم‌راستایی از ۶۵- گذشت",
          sub: `امتیاز ${a.score > 0 ? "+" : ""}${a.score} · سیگنال تایم‌فریم: ${a.signal} · جریان: ${
            a.flow.direction === "buyers" ? "خریداران" : a.flow.direction === "sellers" ? "فروشندگان" : "متعادل"
          }`,
        });
        beep(audioRef, soundRef.current);
      }
    }
    prevRef.current = cur;
  }, [data, toast, tf, symbolId]);

  // Live report #2 — per-timeframe position flips, unified-theory flips and
  // the periodic full market-status report (feed of the AI MESSAGES panel)
  const livePrevRef = useRef<{
    pos: Record<string, string>;
    dir: ConsensusDir;
    bucket: string;
  }>({ pos: {}, dir: "WAIT", bucket: "" });
  useEffect(() => {
    if (!data) return;
    const all: Record<string, TFAnalysis> = {};
    for (const [k, v] of Object.entries(data.tfs)) all[k] = v.analysis;
    const scores: Record<string, number> = Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, v.score])
    );
    const combined = combineSignal(scores);
    const consensus = computeConsensus(combined, ai?.verdict ?? null, dom, all[tf] ?? null);
    const prev = livePrevRef.current;
    const minute = Math.floor(Date.now() / 60_000);

    // per-TF resolved positions — report direction flips with the reason
    const positions = buildTfPositions(data.tfs);
    const curPos: Record<string, string> = {};
    for (const [k, p] of Object.entries(positions)) {
      curPos[k] = p.dir;
      if (prev.pos[k] && prev.pos[k] !== p.dir) {
        const from = prev.pos[k] === "LONG" ? "خرید" : prev.pos[k] === "SHORT" ? "فروش" : "انتظار";
        const to = p.dir === "LONG" ? "خرید ▲" : p.dir === "SHORT" ? "فروش ▼" : "انتظار ◆";
        pushLive(symbolId, {
          id: `tfp-${symbolId}-${k}-${p.dir}-${minute}`,
          t: Date.now(),
          kind: "tfpos",
          tf: TF_LABEL[k],
          text: `پوزیشن ${TF_LABEL[k]} تغییر کرد: ${from} → ${to}`,
          sub: p.reason,
        });
      }
    }

    // unified-theory direction flip
    if (prev.dir !== consensus.dir) {
      if (prev.dir !== "WAIT" || consensus.dir !== "WAIT") {
        const fa = (d: ConsensusDir) => (d === "LONG" ? "خرید ▲" : d === "SHORT" ? "فروش ▼" : "انتظار ◆");
        pushLive(symbolId, {
          id: `cons-${symbolId}-${consensus.dir}-${minute}`,
          t: Date.now(),
          kind: "consensus",
          tf: TF_LABEL[tf],
          text: `⭐ نظریهٔ واحد سیستم تغییر کرد: ${fa(prev.dir)} → ${fa(consensus.dir)} (${Math.abs(consensus.score)}٪)`,
          sub: consensus.entry != null
            ? `پوزیشن واحد جدید — ورود ${fmtPrice(consensus.entry, data.digits)} · استاپ ${fmtPrice(consensus.stop, data.digits)} · هدف۱ ${fmtPrice(consensus.tp1, data.digits)}`
            : consensus.headline,
        });
      }
    }

    // full market-status report — every 5 minutes (گزارش کامل حالات بازار)
    const bucket = `${symbolId}-${Math.floor(Date.now() / 300_000)}`;
    if (prev.bucket !== bucket) {
      const a = all[tf];
      const posLine = TF_IDS.map((k) => `${TF_LABEL[k]}:${positions[k] ? (positions[k].dir === "LONG" ? "خرید" : positions[k].dir === "SHORT" ? "فروش" : "انتظار") : "—"}`).join(" · ");
      pushLive(symbolId, {
        id: `status-${bucket}`,
        t: Date.now(),
        kind: "status",
        tf: TF_LABEL[tf],
        text: `📊 وضعیت بازار: رژیم ${a ? PA_REGIME_FA[a.priceAction.regime] : "—"} · امتیاز کل ${
          combined.score > 0 ? "+" : ""
        }${combined.score} (${combined.signal})`,
        sub: `نظریهٔ واحد: ${consensus.headline} — پوزیشن تایم‌فریم‌ها: ${posLine}${
          a ? ` · جریان: ${a.flow.direction === "buyers" ? "خریداران" : a.flow.direction === "sellers" ? "فروشندگان" : "متعادل"}` : ""
        }`,
      });
    }

    livePrevRef.current = { pos: curPos, dir: consensus.dir, bucket };
  }, [data, ai, dom, tf, symbolId]);

  // Live report #3 — every new SNIPER AI verdict with its Persian reasons
  const aiLiveRef = useRef<string>("");
  useEffect(() => {
    const v = ai?.verdict;
    if (!v) return;
    const sig = `${v.signal}-${v.confidence}`;
    if (aiLiveRef.current && aiLiveRef.current !== sig) {
      const hour = Math.floor(Date.now() / 3_600_000);
      const dirFa = v.signal === "BUY" ? "خرید ▲" : v.signal === "SELL" ? "فروش ▼" : "انتظار ◆";
      pushLive(symbolId, {
        id: `ai-${symbolId}-${v.signal}-${v.confidence}-${hour}`,
        t: Date.now(),
        kind: "ai",
        tf: TF_LABEL[tf],
        text: `🤖 SNIPER AI: ${dirFa} — اطمینان ${v.confidence}٪`,
        sub: v.reasoning.slice(0, 2).join(" · "),
      });
    }
    aiLiveRef.current = sig;
  }, [ai, symbolId, tf]);

  const symbol = SYMBOLS.find((s) => s.id === symbolId) ?? SYMBOLS[0];
  const tfSnap = data?.tfs[tf];
  const all: Record<string, TFAnalysis> = {};
  if (data) for (const [k, v] of Object.entries(data.tfs)) all[k] = v.analysis;
  const combined = combineSignal(
    Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.score]))
  );
  const priceUp = (data?.changePct ?? 0) >= 0;

  // HUD floated over the TradingView chart: every module summarized as signals
  const v = ai?.verdict ?? null;
  const consensus = computeConsensus(combined, v, dom, tfSnap?.analysis ?? null);
  const tvHud = data ? (
    <TvHud
      ai={v}
      all={all}
      combined={combined}
      dom={dom}
      plans={tfSnap?.analysis.plans ?? null}
      consensus={consensus}
      digits={data.digits}
      price={data.price}
    />
  ) : null;

  const toggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      if (next) beep(audioRef, true);
      return next;
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-3 bg-background px-3 pb-8 pt-3">
      {/* Header */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <Radar className="h-5 w-5 text-emerald-400" aria-hidden />
          </div>
          <div>
            <h1 className="flex items-center gap-1.5 text-base font-black leading-tight tracking-wide">
              SMC SNIPER
              <span
                data-testid="app-version"
                className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 ring-1 ring-emerald-500/40"
                title="نسخهٔ ۷.۷: شماتیک OB/FVG و شکل رژیم بازار روی چارت، پوزیشن جداگانهٔ هر ۶ تایم‌فریم، گزارش زندهٔ فارسی لحظه‌به‌لحظه در AI MESSAGES و ادغام اسمارت‌مانی + پرایس‌اکشن در یک کارت"
              >
                v7.8
              </span>
            </h1>
            <p className="text-[10px] leading-tight text-muted-foreground">
              Order Blocks · BOS/CHoCH · Price Action · DOM · TV Chart
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {installEvt && (
            <Button size="sm" className="h-9 gap-1 bg-emerald-500 px-3 text-xs font-bold text-emerald-950 hover:bg-emerald-400" onClick={() => void installEvt.prompt()}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Install
            </Button>
          )}
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9"
            onClick={toggleSound}
            aria-label={soundOn ? "Mute alerts" : "Unmute alerts"}
          >
            {soundOn ? <Volume2 className="h-4 w-4 text-emerald-400" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9"
            onClick={() => void load(symbolId, true)}
            aria-label="Refresh now"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          </Button>
        </div>
      </header>

      {/* Price row */}
      <section className="flex items-end justify-between rounded-xl border border-border bg-card px-4 py-3" aria-label="Current price">
        <div>
          <div className="font-mono text-2xl font-black tabular-nums text-foreground">
            {data ? fmtPrice(data.price, data.digits) : "······"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>
              {symbol.name} · {data ? fmtPct(data.changePct) : "—"} · updated {ago}s ago
            </span>
            {data && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${
                  data.source === "tradingview"
                    ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40"
                    : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40"
                }`}
                title={data.sourceNote ?? ""}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    data.source === "tradingview"
                      ? "animate-pulse bg-emerald-400"
                      : "bg-amber-400"
                  }`}
                  aria-hidden
                />
                {data.source === "tradingview" ? "TV Live" : "Yahoo ·15m"}
              </span>
            )}
          </div>
        </div>
        <span
          className={`rounded-lg px-3 py-1.5 text-sm font-black ${
            priceUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}
        >
          {priceUp ? "▲" : "▼"} {data ? fmtPct(data.changePct, false) : "—"}
        </span>
      </section>

      {/* Symbols */}
      <nav className="grid grid-cols-5 gap-1.5" aria-label="Symbols">
        {SYMBOLS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSymbolId(s.id)}
            className={`h-11 rounded-lg text-[11px] font-bold transition-colors ${
              s.id === symbolId
                ? "bg-emerald-500 text-emerald-950 shadow-[0_0_14px_rgba(34,197,94,0.35)]"
                : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
            aria-pressed={s.id === symbolId}
          >
            {s.name}
          </button>
        ))}
      </nav>

      {/* Timeframes */}
      <nav className="grid grid-cols-6 gap-1.5" aria-label="Timeframes">
        {TF_IDS.map((k) => (
          <button
            key={k}
            onClick={() => setTf(k)}
            className={`h-10 rounded-lg font-mono text-xs font-bold transition-colors ${
              k === tf
                ? "bg-secondary text-foreground ring-1 ring-emerald-500/60"
                : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground"
            }`}
            aria-pressed={k === tf}
          >
            {TF_LABEL[k]}
          </button>
        ))}
      </nav>

      {/* Bulk card open/close — each card's state persists in localStorage */}
      <div className="flex items-center justify-between gap-2" aria-label="Card collapse controls">
        <span className="text-[10px] text-muted-foreground">
          هر کادر یک کلید باز/بسته دارد — چیدمان شما بعد از رفرش هم می‌ماند
        </span>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => setAllCardsOpen(true)}
            className="flex h-7 items-center gap-1 rounded-md bg-card px-2 text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:text-foreground"
          >
            <ChevronsUpDown className="h-3 w-3" aria-hidden /> بازکردن همه
          </button>
          <button
            onClick={() => setAllCardsOpen(false)}
            className="flex h-7 items-center gap-1 rounded-md bg-card px-2 text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:text-foreground"
          >
            <ChevronsDownUp className="h-3 w-3" aria-hidden /> بستن همه
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300" role="alert">
          <span className="font-bold">Data error:</span> {error} — retrying automatically in 30s.
        </div>
      )}

      {!data && loading && (
        <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading market data…
        </div>
      )}

      {data && (
        <>
          <SummaryBoard
            all={all}
            combined={combined}
            ai={ai?.verdict ?? null}
            dom={dom}
            domAll={domAll}
            digits={data.digits}
            selectedTf={tf}
          />

          <AISniperCard symbolId={symbolId} digits={data.digits} />

          <AiMessages symbolId={symbolId} digits={data.digits} />

          <PerformancePanel />

          <TelegramCard
            symbolId={symbolId}
            tf={tf}
            consensus={{
              entry: consensus.entry,
              stop: consensus.stop,
              tp1: consensus.tp1,
              tp2: consensus.tp2,
              dir: consensus.dir,
            }}
          />

          <SignalCard combined={combined} analysis={tfSnap?.analysis} all={all} digits={data.digits} />

          <TfPositionsCard
            tfs={all}
            digits={data.digits}
            selected={tf}
            onSelect={(k) => setTf(k as TFId)}
          />

          <CollapsibleCard
            id="chart"
            fs={chartFs.fs}
            defaultOpen
            title={
              <h2 className="shrink-0 whitespace-nowrap text-sm font-bold tracking-wide">
                {symbol.name} · {TF_LABEL[tf]}
              </h2>
            }
            trailing={
              <>
                {/* TV / EXEC / SMC tab switcher */}
                <div className="flex overflow-hidden rounded-md ring-1 ring-border" role="tablist" aria-label="Chart mode">
                  {(
                    [
                      ["tv", "چارت تریدینگ‌ویو"],
                      ["exec", "TV + پوزیشن"],
                      ["smc", "چارت SMC"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={chartTab === id}
                      onClick={() => setChartTab(id)}
                      className={`px-2 py-1 text-[10px] font-bold transition-colors ${
                        chartTab === id
                          ? "bg-emerald-500 text-emerald-950"
                          : "bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="hidden font-mono text-[10px] text-muted-foreground 2xl:inline-block 2xl:max-w-[210px] 2xl:truncate">
                  {chartTab === "tv"
                    ? "TRADINGVIEW TOOLS · INDICATORS"
                    : chartTab === "exec"
                      ? "CONSENSUS ENTRY · SL · TP1/TP2 · LIQUIDITY · BOS/CHoCH"
                      : "نظریهٔ واحد + شماتیک OB/FVG و رژیم بازار"}
                </span>
                <FsButton fs={chartFs.fs} onToggle={chartFs.toggle} label="chart" />
              </>
            }
          >
            {chartTab === "tv" ? (
              <TvChart
                tvSymbol={symbol.tv}
                interval={TF_TV_INTERVAL[tf] ?? "60"}
                height={chartFs.fs ? "calc(100dvh - 110px)" : 420}
                hud={tvHud}
              />
            ) : chartTab === "exec" ? (
              tfSnap && (
                <ExecutionChart
                  candles={tfSnap.candles}
                  analysis={tfSnap.analysis}
                  consensus={consensus}
                  digits={data.digits}
                  height={chartFs.fs ? "calc(100dvh - 150px)" : 420}
                />
              )
            ) : (
              tfSnap && (
                <CandleChart
                  candles={tfSnap.candles}
                  analysis={tfSnap.analysis}
                  theory={consensus}
                  digits={data.digits}
                  height={chartFs.fs ? 640 : 340}
                />
              )
            )}
          </CollapsibleCard>

          <PressurePanel active={tfSnap?.analysis} all={all} selected={tf} onSelect={(k) => setTf(k as TFId)} />

          <DomPanel symbolId={symbolId} />

          <TradePlanCard plan={tfSnap?.analysis?.plan} digits={data.digits} />

          <SmartMoneyCard analysis={tfSnap?.analysis} digits={data.digits} price={data.price} tf={TF_LABEL[tf]} />
        </>
      )}

      {/* Footer / disclaimer */}
      <footer className="mt-auto pt-4 text-center">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {data?.source === "tradingview"
            ? `Data: TradingView live feed (${data.tv}) · Auto-refresh 30s`
            : data?.source === "yahoo"
              ? `Data: Yahoo Finance, delayed up to ~15 min (${data.yahoo}) · Auto-refresh 30s`
              : "Auto-refresh 30s"}
          <br />
          Educational tool only — not financial advice. Trade at your own risk.
        </p>
      </footer>
    </main>
  );
}

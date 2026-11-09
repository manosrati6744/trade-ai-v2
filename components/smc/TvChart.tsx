"use client";

/**
 * TvChart — the REAL TradingView Advanced Chart.
 *
 * v3.1 rewrite: instead of injecting the official embed script
 * (s3.tradingview.com/external-embedding/... which is fragile: blocked hosts,
 * races with React cleanup, silent blank box), we embed the chart IFRAME
 * directly. The iframe URL below is exactly what that script builds
 * internally — same full chart, same drawing tools, same indicators — but
 * with a single network resource and full control over loading / error UI.
 *
 * Robustness:
 *  - two embed hosts tried in order (www.tradingview.com → s.tradingview.com);
 *    the watchdog switches host automatically if a frame never fires onLoad
 *  - explicit loading overlay + Persian error state with "retry" and
 *    "open on tradingview.com" buttons
 *  - state is derived (loadedSrc vs src) so no setState runs inside effects
 *  - iframe remounts via key on symbol/interval/retry change; height changes
 *    (fullscreen) only resize the frame without reloading it
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  tvSymbol: string; // e.g. "OANDA:XAUUSD"
  interval: string; // TradingView interval: 5 | 15 | 30 | 60 | 240 | D
  height: number | string;
  /** HUD floated over the chart (TvHud). pointer-events-none so the
   *  TradingView UI underneath stays fully interactive. */
  hud?: React.ReactNode;
}

const TV_HOSTS = ["https://www.tradingview.com", "https://s.tradingview.com"];
const ATTEMPT_TIMEOUT_MS = 25_000;

/** Basic studies the user can pin on the TradingView chart itself. */
const STUDY_CHOICES: { id: string; fa: string }[] = [
  { id: "RSI@tv-basicstudies", fa: "RSI" },
  { id: "MACD@tv-basicstudies", fa: "MACD" },
  { id: "MASimple@tv-basicstudies", fa: "MA" },
  { id: "BB@tv-basicstudies", fa: "بولینگر" },
  { id: "Stochastic@tv-basicstudies", fa: "استوکاستیک" },
  { id: "ATR@tv-basicstudies", fa: "ATR" },
  { id: "Volume@tv-basicstudies", fa: "حجم" },
];
const DEFAULT_STUDIES = ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "Volume@tv-basicstudies"];

export default function TvChart({ tvSymbol, interval, height, hud }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // manual retry counter
  const [studies, setStudies] = useState<string[]>(DEFAULT_STUDIES);

  const src = useMemo(() => {
    const p = new URLSearchParams({
      symbol: tvSymbol,
      interval,
      theme: "dark",
      style: "1",
      timezone: "Asia/Tehran",
      locale: "fa",
      hide_side_toolbar: "0", // keep TradingView DRAWING TOOLS
      hide_top_toolbar: "0",
      allow_symbol_change: "1",
      withdateranges: "1",
      details: "0",
      save_image: "1",
      studies: JSON.stringify(studies),
      backgroundColor: "rgba(11, 14, 17, 1)",
      gridColor: "rgba(240, 243, 250, 0.06)",
    });
    return `${TV_HOSTS[attempt]}/widgetembed/?${p.toString()}`;
  }, [tvSymbol, interval, attempt, studies]);

  // watchdog: while this URL is still loading, flip to the fallback host if
  // onLoad never fires — but never touch a chart that has already loaded
  // (the timer must not outlive the load and kill a working chart)
  useEffect(() => {
    if (loadedSrc === src) return; // this exact URL already loaded — stand down
    const t = setTimeout(() => {
      if (attempt + 1 < TV_HOSTS.length) setAttempt(attempt + 1); // try fallback host
      else setFailed(true); // both hosts exhausted
    }, ATTEMPT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [src, nonce, attempt, loadedSrc]);

  const state = failed ? "error" : loadedSrc === src ? "ready" : "loading";

  const handleLoad = () => setLoadedSrc(src);

  const retry = () => {
    setFailed(false);
    setAttempt((a) => (a + 1) % TV_HOSTS.length); // alternate host on retry
    setNonce((n) => n + 1);
  };

  const openOnTv = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}`;

  return (
    <div className="w-full" aria-label="TradingView advanced chart">
      {/* indicator picker — pins basic studies on the TradingView chart itself */}
      <div
        className="flex flex-wrap items-center gap-1 rounded-t-lg border border-b-0 border-border bg-secondary/40 px-1.5 py-1"
        role="group"
        aria-label="اندیکاتورهای روی چارت تریدینگ‌ویو"
      >
        <span className="text-[9px] font-bold text-muted-foreground">اندیکاتور:</span>
        {STUDY_CHOICES.map((s) => {
          const on = studies.includes(s.id);
          return (
            <button
              key={s.id}
              aria-pressed={on}
              onClick={() =>
                setStudies((cur) =>
                  cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]
                )
              }
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold transition-colors ${
                on
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/50"
                  : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground"
              }`}
            >
              {s.fa}
            </button>
          );
        })}
      </div>

      <div
        style={{ height: typeof height === "number" ? `${height}px` : height }}
        className="relative w-full overflow-hidden rounded-b-lg border border-border bg-[#0b0e11]"
      >
        {!failed && (
          <iframe
            key={`${src}#${nonce}`}
            src={src}
            title="TradingView chart"
            className="h-full w-full border-0"
            loading="eager"
            allow="clipboard-write; fullscreen"
            allowFullScreen
            onLoad={handleLoad}
          />
        )}

        {/* HUD floated over the chart — never blocks chart interaction */}
        {hud && state === "ready" && hud}

      {state === "loading" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0b0e11]/90 text-center">
          <RefreshCw className="h-7 w-7 animate-spin text-emerald-400" aria-hidden />
          <div>
            <p className="text-sm font-bold text-emerald-400">
              در حال بارگذاری چارت تریدینگ‌ویو…
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              اتصال به سرور TradingView (تا ۲۵ ثانیه)
            </p>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0b0e11] p-4 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-400" aria-hidden />
          <div>
            <p className="text-sm font-bold text-amber-400">
              چارت تریدینگ‌ویو لود نشد
            </p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] leading-5 text-muted-foreground">
              اتصال به tradingview.com برقرار نشد — احتمالاً اینترنت، فیلترشکن یا
              DNS قطع است. تب «چارت SMC» خود اپ مستقل از این سرور کار می‌کند.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1 bg-emerald-500 px-3 text-xs font-bold text-emerald-950 hover:bg-emerald-400"
              onClick={retry}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> تلاش مجدد
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1 px-3 text-xs"
              onClick={() => window.open(openOnTv, "_blank", "noopener")}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> باز کردن در سایت
              تریدینگ‌ویو
            </Button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

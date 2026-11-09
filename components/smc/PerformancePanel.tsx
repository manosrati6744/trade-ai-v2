"use client";

/**
 * PerformancePanel — the system's track record, international style.
 *
 * KPI cards (net P&L, win rate, profit factor, expectancy, max drawdown,
 * long/short split) + equity curve, daily/monthly P&L bars, win/loss donut,
 * monthly table and the last trades — straight from the virtual journal.
 * A clearly-labelled demo dataset can be loaded just to preview the layout;
 * it lives in its own file and never feeds the learning brain.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Database, Trash2, RefreshCw } from "lucide-react";
import FsButton from "@/components/smc/FsButton";
import CollapsibleCard from "@/components/smc/CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";
import type { Bucket, PerfStats } from "@/lib/smc/performance";

const signFmt = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const numFmt = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : v.toFixed(d);
const pnlColor = (v: number | null | undefined) =>
  v == null ? "text-muted-foreground" : v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-muted-foreground";
const FA_MONTHS = ["ژانویه","فوریه","مارس","آوریل","مه","ژوئن","ژوئیه","اوت","سپتامبر","اکتبر","نوامبر","دسامبر"];

const TT_STYLE = {
  background: "#0d1420",
  border: "1px solid #243044",
  borderRadius: 8,
  fontSize: 11,
  color: "#e5e7eb",
  direction: "rtl" as const,
};

function KpiCard({
  title, en, value, sub, tone = "neutral",
}: {
  title: string; en: string; value: string; sub?: string; tone?: "up" | "down" | "neutral";
}) {
  const toneCls = tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-2.5 py-2" dir="rtl">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground" dir="ltr">{en}</div>
      <div className="text-[11px] font-semibold text-foreground/80">{title}</div>
      <div className={`mt-0.5 font-mono text-base font-bold ${toneCls}`} dir="ltr">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PeriodCards({ stats }: { stats: PerfStats }) {
  const rows: { label: string; b: Bucket | null; tone?: boolean }[] = [
    { label: "امروز", b: stats.today?.trades ? stats.today : null },
    { label: "این ماه", b: stats.mtd?.trades ? stats.mtd : null },
    { label: "امسال", b: stats.ytd?.trades ? stats.ytd : null },
    { label: "بدترین روز", b: stats.worstDay, tone: true },
    { label: "بدترین ماه", b: stats.worstMonth, tone: true },
    { label: "بدترین سال", b: stats.worstYear, tone: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {rows.map(({ label, b, tone }) => {
        const v = b ? b.pnl : null;
        const isLoss = tone && b ? b.pnl < 0 : v != null && v < 0;
        return (
          <div key={label} className={`rounded-lg border px-2.5 py-2 ${isLoss ? "border-red-500/30 bg-red-500/5" : "border-border bg-secondary/40"}`} dir="rtl">
            <div className="text-[10px] font-semibold text-muted-foreground">
              {label}
              {b && tone ? ` · ${b.label}` : ""}
            </div>
            <div className={`font-mono text-sm font-bold ${pnlColor(v)}`} dir="ltr">
              {v == null ? "—" : `${signFmt(v)} pt`}
            </div>
            <div className="text-[10px] text-muted-foreground" dir="ltr">
              {b ? `${b.trades} trade · ${signFmt(b.r, 2)}R` : "بدون معامله"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EquityChart({ stats, tall }: { stats: PerfStats; tall: boolean }) {
  if (stats.equity.length < 2) {
    return <div className="flex h-32 items-center justify-center text-[11px] text-muted-foreground">منحنی سرمایه بعد از ۲ معاملهٔ بسته‌شده رسم می‌شود</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={tall ? 260 : 170}>
      <AreaChart data={stats.equity} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1d2839" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="i" tick={{ fill: "#6b7280", fontSize: 9 }} stroke="#243044" tickLine={false} />
        <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} stroke="#243044" tickLine={false} width={38} domain={["auto", "auto"]} />
        <Tooltip contentStyle={TT_STYLE} formatter={(v) => [`${signFmt(Number(v))}R`, "جمع R"]} labelFormatter={(l) => `معامله ${l}`} />
        <Area type="monotone" dataKey="cumR" stroke="#10b981" strokeWidth={1.8} fill="url(#eqFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PnlBars({ data, tall, dataKey = "pnl" }: { data: Bucket[]; tall: boolean; dataKey?: "pnl" | "r" }) {
  return (
    <ResponsiveContainer width="100%" height={tall ? 220 : 150}>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#1d2839" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 8 }} stroke="#243044" tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} stroke="#243044" tickLine={false} width={38} />
        <Tooltip contentStyle={TT_STYLE} cursor={{ fill: "#ffffff08" }} formatter={(v) => [`${signFmt(Number(v))} pt`, "سود/زیان"]} />
        <Bar dataKey={dataKey} isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((b, i) => (
            <Cell key={i} fill={b[dataKey] >= 0 ? "#10b981" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function WinDonut({ stats, tall }: { stats: PerfStats; tall: boolean }) {
  const data = [
    { name: "برد", value: stats.wins, fill: "#10b981" },
    { name: "باخت", value: stats.losses, fill: "#ef4444" },
  ];
  const total = stats.wins + stats.losses;
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={tall ? 220 : 150}>
        <PieChart>
          <Pie data={total ? data : []} dataKey="value" innerRadius="62%" outerRadius="88%" paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
            {total ? data.map((d, i) => <Cell key={i} fill={d.fill} />) : null}
          </Pie>
          <Tooltip contentStyle={TT_STYLE} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-lg font-bold text-foreground">{stats.winRate == null ? "—" : `${stats.winRate.toFixed(1)}%`}</span>
        <span className="text-[9px] text-muted-foreground">نرخ برد</span>
      </div>
    </div>
  );
}

export default function PerformancePanel() {
  const fs = usePanelFs();
  const [stats, setStats] = useState<PerfStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStats((await r.json()) as PerfStats);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  const demo = useCallback(async (action: "seed" | "clear") => {
    setBusy(true);
    try {
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 30_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  if (!stats) {
    return (
      <section className="rounded-xl border border-border bg-card p-3" aria-label="Performance">
        <h2 className="text-sm font-bold">📊 آمار عملکرد</h2>
        <div className="flex h-24 items-center justify-center text-[11px] text-muted-foreground">
          {err ? `خطا در دریافت آمار: ${err}` : <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />}
        </div>
      </section>
    );
  }

  const longWR = stats.longs.winRate, shortWR = stats.shorts.winRate;
  const monthlyData = [...stats.monthly].reverse().slice(0, 12); // newest first for the table

  return (
    <CollapsibleCard
      id="performance"
      fs={fs.fs}
      defaultOpen={false}
      title={
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold tracking-wide">📊 آمار عملکرد سیستم</h2>
          <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">PERFORMANCE · JOURNAL ANALYTICS</span>
        </div>
      }
      trailing={
        <div className="flex items-center gap-1.5">
          {stats.demoActive && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 ring-1 ring-amber-500/40">دادهٔ نمونه</span>
          )}
          <FsButton fs={fs.fs} onToggle={fs.toggle} label="performance" />
        </div>
      }
    >

      {/* KPI grid */}
      <div className={`grid gap-1.5 ${fs.fs ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3"}`}>
        <KpiCard en="NET P&L" title="سود / زیان خالص" tone={stats.netPnl > 0 ? "up" : stats.netPnl < 0 ? "down" : "neutral"}
          value={`${signFmt(stats.netPnl)} pt`} sub={`${signFmt(stats.netR)}R · ${stats.closed} معاملهٔ بسته`} />
        <KpiCard en="WIN RATE" title="نرخ برد" tone={stats.winRate != null && stats.winRate >= 50 ? "up" : "neutral"}
          value={stats.winRate == null ? "—" : `${stats.winRate.toFixed(1)}%`} sub={`${stats.wins} برد / ${stats.losses} باخت`} />
        <KpiCard en="PROFIT FACTOR" title="پروفیت فاکتور" tone={stats.profitFactor != null && stats.profitFactor >= 1.5 ? "up" : stats.profitFactor != null && stats.profitFactor < 1 ? "down" : "neutral"}
          value={stats.profitFactor == null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
          sub={`سود ${numFmt(stats.grossProfitR, 1)}R / ضرر ${numFmt(stats.grossLossR, 1)}R`} />
        <KpiCard en="EXPECTANCY" title="انتظار ریاضی" tone={stats.expectancyR != null && stats.expectancyR > 0 ? "up" : "down"}
          value={stats.expectancyR == null ? "—" : `${signFmt(stats.expectancyR)}R`} sub="میانگین R هر معامله" />
        <KpiCard en="MAX DRAWDOWN" title="حداکثر افت سرمایه" tone="down"
          value={`${numFmt(stats.maxDDr, 2)}R`} sub={stats.recoveryFactor != null ? `فاکتور بازیابی ${numFmt(stats.recoveryFactor, 2)}` : undefined} />
        <KpiCard en="TRADES" title="تعداد پوزیشن‌ها" tone="neutral"
          value={`${stats.closed + stats.open}`} sub={`${stats.longs.n} خرید · ${stats.shorts.n} فروش · ${stats.open} باز`} />
      </div>

      {/* Long vs short split */}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2" dir="rtl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-400">▲ خرید / LONG</span>
            <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{stats.longs.n} trades</span>
          </div>
          <div className="mt-0.5 font-mono text-xs" dir="ltr">
            <span className="text-muted-foreground">WR </span><span className="font-bold">{longWR == null ? "—" : `${longWR.toFixed(1)}%`}</span>
            <span className="text-muted-foreground"> · R </span><span className={`font-bold ${pnlColor(stats.longs.r)}`}>{signFmt(stats.longs.r)}</span>
            <span className="text-muted-foreground"> · P&L </span><span className={`font-bold ${pnlColor(stats.longs.pnl)}`}>{signFmt(stats.longs.pnl)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2" dir="rtl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-red-400">▼ فروش / SHORT</span>
            <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">{stats.shorts.n} trades</span>
          </div>
          <div className="mt-0.5 font-mono text-xs" dir="ltr">
            <span className="text-muted-foreground">WR </span><span className="font-bold">{shortWR == null ? "—" : `${shortWR.toFixed(1)}%`}</span>
            <span className="text-muted-foreground"> · R </span><span className={`font-bold ${pnlColor(stats.shorts.r)}`}>{signFmt(stats.shorts.r)}</span>
            <span className="text-muted-foreground"> · P&L </span><span className={`font-bold ${pnlColor(stats.shorts.pnl)}`}>{signFmt(stats.shorts.pnl)}</span>
          </div>
        </div>
      </div>

      {/* Period losses */}
      <h3 className="mt-3 mb-1 px-1 text-[11px] font-bold text-muted-foreground">سود / زیان به تفکیک دوره + بدترین افت‌ها</h3>
      <PeriodCards stats={stats} />

      {/* Charts */}
      <div className={`mt-3 grid gap-3 ${fs.fs ? "grid-cols-1 lg:grid-cols-3" : "grid-cols-1"}`}>
        <div className="rounded-lg border border-border bg-secondary/30 p-2">
          <div className="mb-1 text-[11px] font-bold" dir="rtl">منحنی رشد سرمایه <span className="font-mono text-[9px] text-muted-foreground" dir="ltr">EQUITY CURVE (R)</span></div>
          <EquityChart stats={stats} tall={fs.fs} />
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-2">
          <div className="mb-1 text-[11px] font-bold" dir="rtl">برد / باخت <span className="font-mono text-[9px] text-muted-foreground" dir="ltr">WIN / LOSS</span></div>
          <WinDonut stats={stats} tall={fs.fs} />
        </div>
        <div className="rounded-lg border border-border bg-secondary/30 p-2">
          <div className="mb-1 text-[11px] font-bold" dir="rtl">سود / زیان روزانه (۱۴ روز اخیر)</div>
          <PnlBars data={stats.daily} tall={fs.fs} />
        </div>
      </div>
      <div className="mt-3 rounded-lg border border-border bg-secondary/30 p-2">
        <div className="mb-1 text-[11px] font-bold" dir="rtl">بازده ماهانه (۱۲ ماه اخیر) <span className="font-mono text-[9px] text-muted-foreground" dir="ltr">MONTHLY RETURNS</span></div>
        <PnlBars data={stats.monthly} tall={fs.fs} />
      </div>

      {/* Monthly table */}
      <h3 className="mt-3 mb-1 px-1 text-[11px] font-bold text-muted-foreground">جدول عملکرد ماهانه</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[10px]" dir="rtl">
          <thead>
            <tr className="bg-secondary/60 text-muted-foreground">
              <th className="px-2 py-1.5 text-right font-semibold">ماه</th>
              <th className="px-2 py-1.5 font-semibold">معاملات</th>
              <th className="px-2 py-1.5 font-semibold">برد</th>
              <th className="px-2 py-1.5 font-semibold">باخت</th>
              <th className="px-2 py-1.5 font-semibold">نرخ برد</th>
              <th className="px-2 py-1.5 font-semibold">R خالص</th>
              <th className="px-2 py-1.5 font-semibold">سود/زیان (pt)</th>
            </tr>
          </thead>
          <tbody className="font-mono" dir="ltr">
            {monthlyData.filter((b) => b.trades > 0).length === 0 ? (
              <tr><td colSpan={7} className="px-2 py-3 text-center font-sans text-muted-foreground" dir="rtl">هنوز معاملهٔ بسته‌شده‌ای ثبت نشده</td></tr>
            ) : (
              monthlyData.filter((b) => b.trades > 0).map((b) => (
                <tr key={b.key} className="border-t border-border/60">
                  <td className="px-2 py-1.5 font-sans" dir="rtl">{b.label}</td>
                  <td className="px-2 py-1.5 text-center">{b.trades}</td>
                  <td className="px-2 py-1.5 text-center text-emerald-400">{b.wins}</td>
                  <td className="px-2 py-1.5 text-center text-red-400">{b.losses}</td>
                  <td className="px-2 py-1.5 text-center">{((b.wins / Math.max(1, b.wins + b.losses)) * 100).toFixed(0)}%</td>
                  <td className={`px-2 py-1.5 text-center font-bold ${pnlColor(b.r)}`}>{signFmt(b.r)}</td>
                  <td className={`px-2 py-1.5 text-center font-bold ${pnlColor(b.pnl)}`}>{signFmt(b.pnl)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Recent trades */}
      <h3 className="mt-3 mb-1 px-1 text-[11px] font-bold text-muted-foreground">آخرین معاملات (۱۰ مورد)</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[10px]" dir="rtl">
          <thead>
            <tr className="bg-secondary/60 text-muted-foreground">
              <th className="px-2 py-1.5 text-right font-semibold">جهت</th>
              <th className="px-2 py-1.5 font-semibold">ورود</th>
              <th className="px-2 py-1.5 font-semibold">خروج</th>
              <th className="px-2 py-1.5 font-semibold">نتیجه</th>
              <th className="px-2 py-1.5 font-semibold">R</th>
              <th className="px-2 py-1.5 font-semibold">اطمینان</th>
              <th className="px-2 py-1.5 font-semibold">زمان بستن</th>
            </tr>
          </thead>
          <tbody className="font-mono" dir="ltr">
            {stats.recent.length === 0 ? (
              <tr><td colSpan={7} className="px-2 py-3 text-center font-sans text-muted-foreground" dir="rtl">—</td></tr>
            ) : (
              stats.recent.map((t) => (
                <tr key={t.id} className="border-t border-border/60">
                  <td className={`px-2 py-1.5 text-right font-sans font-bold ${t.side === "LONG" ? "text-emerald-400" : "text-red-400"}`} dir="rtl">
                    {t.side === "LONG" ? "خرید" : "فروش"}{t.demo ? " (نمونه)" : ""}
                  </td>
                  <td className="px-2 py-1.5 text-center">{t.entry.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-center">{t.exit?.toFixed(2) ?? "—"}</td>
                  <td className={`px-2 py-1.5 text-center font-bold ${t.outcome === "win" ? "text-emerald-400" : t.outcome === "loss" ? "text-red-400" : "text-muted-foreground"}`}>
                    {t.outcome === "win" ? "برد" : t.outcome === "loss" ? "باخت" : t.outcome === "open" ? "باز" : t.outcome === "expired" ? "منقضی" : "لغو"}
                  </td>
                  <td className={`px-2 py-1.5 text-center font-bold ${pnlColor(t.r)}`}>{signFmt(t.r)}</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground">{t.confidence}%</td>
                  <td className="px-2 py-1.5 text-center text-muted-foreground">
                    {t.tClosed ? new Date(t.tClosed).toLocaleString("fa-IR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Extra metrics strip */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]" dir="rtl">
        {[
          ["میانگین برد", stats.avgWinR != null ? `+${stats.avgWinR.toFixed(2)}R` : "—"],
          ["میانگین باخت", stats.avgLossR != null ? `−${stats.avgLossR.toFixed(2)}R` : "—"],
          ["بهترین معامله", stats.bestR != null ? `${signFmt(stats.bestR)}R` : "—"],
          ["بدترین معامله", stats.worstR != null ? `${signFmt(stats.worstR)}R` : "—"],
          ["بیشترین برد متوالی", `${stats.maxWinStreak}`],
          ["بیشترین باخت متوالی", `${stats.maxLossStreak}`],
          ["میانگین زمان نگهداری", stats.avgHoldMin != null ? `${stats.avgHoldMin < 90 ? `${Math.round(stats.avgHoldMin)} دقیقه` : `${(stats.avgHoldMin / 60).toFixed(1)} ساعت`}` : "—"],
        ].map(([k, v]) => (
          <span key={k} className="rounded-md bg-secondary/60 px-2 py-1 ring-1 ring-border">{k}: <span className="font-mono font-bold" dir="ltr">{v}</span></span>
        ))}
      </div>

      {/* Demo controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2" dir="rtl">
        {stats.demoActive ? (
          <button onClick={() => demo("clear")} disabled={busy}
            className="flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1.5 text-[10px] font-bold text-red-400 ring-1 ring-red-500/40 transition-colors hover:bg-red-500/20 disabled:opacity-50">
            <Trash2 className="h-3 w-3" aria-hidden /> پاک‌کردن دادهٔ نمونه
          </button>
        ) : (
          <button onClick={() => demo("seed")} disabled={busy}
            className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-400 ring-1 ring-amber-500/40 transition-colors hover:bg-amber-500/20 disabled:opacity-50">
            <Database className="h-3 w-3" aria-hidden /> بارگذاری دادهٔ نمونه (فقط نمایش ظاهر — در ژورنال واقعی ثبت نمی‌شود)
          </button>
        )}
        <button onClick={load} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-muted-foreground ring-1 ring-border transition-colors hover:text-foreground">
          <RefreshCw className="h-3 w-3" aria-hidden /> به‌روزرسانی
        </button>
        <span className="text-[9px] text-muted-foreground">واحد pt = دلارِ حرکت قیمت نماد · R = سود/زیان نسبت به ریسک هر معامله</span>
      </div>
    </CollapsibleCard>
  );
}

"use client";

/**
 * TelegramCard — connect the app to a Telegram bot and push
 * signals / results / daily reports to the owner's chat.
 *
 * One-time setup (shown inline): create a bot with @BotFather, paste the
 * token here, press START on the bot from the owner's account (the phone
 * number is stored as the owner reference — Telegram bots can only message
 * a chat that has already talked to them), then hit «اتصال».
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Send, Image as ImageIcon, Link2, Unplug, Stethoscope, Radar } from "lucide-react";
import CollapsibleCard from "./CollapsibleCard";

interface TgStatus {
  connected: boolean;
  tokenMasked: string;
  tokenSaved: boolean;
  tokenOk: boolean | null;
  hasChat: boolean;
  botUsername: string | null;
  proxy: string | null;
  ownerPhone: string;
  enabled: boolean;
  autoSignals: boolean;
  autoResults: boolean;
  autoDaily: boolean;
}

interface TgHealth {
  network: { ok: boolean; detail: string };
  token: { ok: boolean; detail: string };
  chat: { ok: boolean; detail: string };
  webhook: { ok: boolean; detail: string };
}

interface ConsensusLevels {
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  dir: string;
}

export default function TelegramCard({
  symbolId = "XAUUSD",
  tf = "1h",
  consensus = null,
}: {
  symbolId?: string;
  tf?: string;
  consensus?: ConsensusLevels | null;
}) {
  const [st, setSt] = useState<TgStatus | null>(null);
  const [token, setToken] = useState("");
  const [phone, setPhone] = useState("");
  const [proxy, setProxy] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [health, setHealth] = useState<TgHealth | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/telegram?action=status", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as TgStatus;
        setSt(j);
        if (!phone && j.ownerPhone) setPhone(j.ownerPhone);
        if (!proxy && j.proxy) setProxy(j.proxy);
      }
    } catch {
      /* offline tick */
    }
  }, [phone, proxy]);

  useEffect(() => {
    load();
    // keep command polling alive while the app is open (/start, /stats)
    timer.current = setInterval(async () => {
      try {
        const s = await fetch("/api/telegram?action=status", { cache: "no-store" });
        if (s.ok) {
          const j = (await s.json()) as TgStatus;
          setSt(j);
          if (j.connected) fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }, 45_000);
    return () => { if (timer.current) clearInterval(timer.current); };
     
  }, []);

  /** POST that can never fail silently — the #1 «کلیک می‌کنم و هیچ نمی‌شود» killer. */
  const post = async (body: Record<string, unknown>): Promise<{
    ok: boolean; error?: string; botUsername?: string; needsStart?: boolean; kind?: string; proxy?: string; message?: string;
  }> => {
    try {
      const r = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      try {
        return JSON.parse(t);
      } catch {
        return { ok: false, error: `سرور پاسخ نامعتبر داد (HTTP ${r.status}). اگر فایل‌ها را تازه جایگزین کرده‌اید: سرور را خاموش/روشن کنید و صفحه را با Ctrl+Shift+R باز کنید.` };
      }
    } catch {
      return { ok: false, error: "ارتباط با سرور اپ برقرار نشد — سرور اپ (npm run dev یا npm start) روشن نیست یا آدرس صفحه درست باز نشده است." };
    }
  };

  const cleanToken = (raw: string) => {
    // strip whitespace + invisible RTL/zero-width chars that ride along when
    // the token is copied out of a Persian Telegram chat
    const s = raw.replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
      .replace(/^[`"'«\[\(]+|[`"'»\]\)]+$/g, "");
    const m = s.match(/(\d{5,12}:[A-Za-z0-9_-]{20,})/);
    return m ? m[1] : s;
  };

  /** Auto-detect a working local proxy (Clash/V2Ray/sing-box ports) and save it. */
  const tryScan = async (): Promise<string | null> => {
    const j = await post({ action: "scan-proxy" });
    if (j.ok && j.proxy) {
      setProxy(j.proxy);
      return j.proxy;
    }
    return null;
  };

  const doSave = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const tok = cleanToken(token);
      const prx = proxy.trim();
      // only reject when literally nothing new was entered — clearing a stale
      // proxy (or editing the phone) must stay possible without a token
      const nothingNew = !tok && !prx && prx === (st?.proxy ?? "")
        && phone.trim() === (st?.ownerPhone ?? "");
      if (nothingNew) {
        setMsg({ kind: "err", text: "چیزی برای ذخیره وارد نشده — توکن ربات را از @BotFather کپی و در کادر بالا بچسبانید (یا پورت پروکسی را اصلاح کنید)." });
        return;
      }
      const j = await post({ action: "save", token: tok || undefined, ownerPhone: phone, proxy: prx }) as { ok: boolean; error?: string; message?: string };
      setMsg(j.ok
        ? { kind: "ok", text: j.message ?? (tok ? "توکن ذخیره شد — حالا دکمهٔ «اتصال» را بزنید." : "تنظیمات ذخیره شد.") }
        : { kind: "err", text: j.error ?? "خطا" });
      if (tok) setToken("");
      await load();
    } finally {
      setBusy("");
    }
  };

  const doConnect = async () => {
    setBusy("connect");
    setMsg(null);
    try {
      const j = await post({ action: "connect" }) as { ok: boolean; error?: string; botUsername?: string; needsStart?: boolean; kind?: string; proxyUsed?: string | null; proxyChanged?: boolean };
      if (j.ok) {
        const via = j.proxyUsed ? ` (با پروکسی ${j.proxyUsed})` : "";
        setMsg({ kind: "ok", text: `متصل شد — پوش به ${j.botUsername} فعال است${via}.` });
        if (j.proxyChanged) setMsg({ kind: "ok", text: `متصل شد — پوش به ${j.botUsername} فعال است.${via} تنظیمات پروکسی اصلاح و ذخیره شد.` });
      } else if (j.kind === "network") {
        const found = await tryScan();
        if (found) setMsg({ kind: "ok", text: `اتصال مستقیم به تلگرام نشد (تحریم)، اما پروکسی ${found} خودکار پیدا و ذخیره شد — همین حالا دوباره «اتصال» را بزنید.` });
        else setMsg({ kind: "err", text: j.error ?? "خطای شبکه" });
      } else setMsg({ kind: j.needsStart ? "info" : "err", text: j.error ?? "اتصال ناقص" });
      await load();
    } finally {
      setBusy("");
    }
  };

  const doHealth = async () => {
    setBusy("health");
    setMsg(null);
    setHealth(null);
    try {
      const j = await post({ action: "health" }) as { ok: boolean; health?: TgHealth; error?: string };
      if (j.health) {
        setHealth(j.health);
        if (j.health.network.ok === false) {
          const found = await tryScan();
          if (found) setMsg({ kind: "ok", text: `پروکسی ${found} خودکار پیدا و ذخیره شد — دوباره «تست سلامت» را بزنید تا همهٔ مراحل سبز شود.` });
        }
      } else setMsg({ kind: "err", text: j.error ?? "تست سلامت ناموفق بود" });
    } finally {
      setBusy("");
    }
  };

  const doScan = async () => {
    setBusy("scan");
    setMsg(null);
    try {
      const found = await tryScan();
      setMsg(found
        ? { kind: "ok", text: `پروکسی محلی پیدا و ذخیره شد: ${found} — حالا دکمهٔ «اتصال» را بزنید.` }
        : { kind: "err", text: "هیچ پروکسی HTTP محلی پیدا نشد — VPN را روی «کل سیستم» روشن کنید (حالت TUN)، یا برنامهٔ VPN خود (کلش/v2rayN) را باز کنید و پورت HTTP آن را در کادر «پروکسی» وارد کنید (مثال: http://127.0.0.1:7890)." });
      await load();
    } finally {
      setBusy("");
    }
  };

  const doTest = async () => {
    setBusy("test");
    setMsg(null);
    try {
      const j = await post({ action: "test", sym: symbolId, tf });
      setMsg(j.ok ? { kind: "ok", text: "کارت تست به تلگرام ارسال شد — چک کنید." } : { kind: "err", text: j.error ?? "ارسال ناموفق" });
    } finally {
      setBusy("");
    }
  };

  const doSummary = async () => {
    setBusy("summary");
    setMsg(null);
    try {
      const j = await post({ action: "summary" });
      setMsg(j.ok ? { kind: "ok", text: "گزارش عملکرد ارسال شد." } : { kind: "err", text: j.error ?? "ارسال ناموفق" });
    } finally {
      setBusy("");
    }
  };

  const toggle = async (key: "enabled" | "autoSignals" | "autoResults" | "autoDaily", v: boolean) => {
    await post({ action: "save", [key]: v });
    await load();
  };

  const showPreview = () => {
    const p = new URLSearchParams({ action: "preview", sym: symbolId, tf, side: consensus?.dir === "LONG" ? "BUY" : "SELL" });
    for (const [k, v] of [["entry", consensus?.entry], ["stop", consensus?.stop], ["tp1", consensus?.tp1], ["tp2", consensus?.tp2]] as const) {
      if (v != null) p.set(k, String(v));
    }
    setPreviewUrl(`/api/telegram?${p.toString()}#${Date.now()}`);
  };

  const Toggle = ({ k, label }: { k: "enabled" | "autoSignals" | "autoResults" | "autoDaily"; label: string }) => (
    <button
      onClick={() => st && toggle(k, !st[k])}
      className={`rounded-md px-2 py-1 text-[10px] font-bold ring-1 transition-colors ${
        st?.[k] ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/40" : "bg-secondary text-muted-foreground ring-border"
      }`}
      dir="rtl"
    >
      {st?.[k] ? "● " : "○ "}
      {label}
    </button>
  );

  return (
    <CollapsibleCard
      id="telegram"
      accentCls="border-sky-500/20"
      defaultOpen={false}
      title={
        <>
          <h2 className="text-sm font-bold tracking-wide">📤 پوش تلگرام</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-bold ring-1 ${
              st?.connected ? "bg-emerald-500/15 text-emerald-400 ring-emerald-500/40"
                : st?.tokenSaved ? "bg-amber-500/10 text-amber-400 ring-amber-500/40"
                : "bg-secondary text-muted-foreground ring-border"
            }`}
          >
            {st?.connected ? `متصل ${st.botUsername ?? ""}`
              : st?.tokenSaved ? "توکن ذخیره شد — «اتصال» را بزنید"
              : "وصل نیست"}
          </span>
        </>
      }
      subtitle={<span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">TELEGRAM PUSH · SIGNALS · RESULTS · DAILY</span>}
      trailing={
        <button onClick={load} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="refresh telegram">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </button>
      }
    >

      {/* setup steps */}
      <ol className="mb-2 space-y-0.5 rounded-lg bg-secondary/40 px-3 py-2 text-[10px] leading-5 text-muted-foreground" dir="rtl">
        <li>۱. در تلگرام به <span className="font-bold text-foreground">@BotFather</span> پیام دهید و با دستور <span className="font-mono">/newbot</span> یک ربات بسازید و توکن را کپی کنید.</li>
        <li>۲. توکن را زیر وارد و ذخیره کنید (شمارهٔ مالک: <span className="font-mono text-foreground">{phone || "09123633595"}</span> — به‌عنوان مرجع ثبت می‌شود).</li>
        <li>۳. از همان اکانت تلگرامِ خودتان (شمارهٔ بالا) روی ربات دکمهٔ <span className="font-bold text-foreground">START</span> را بزنید — بات‌ها فقط به چتِ شروع‌شده می‌توانند پیام دهند.</li>
        <li>۴. دکمهٔ «اتصال» را بزنید؛ بعد «ارسال تست» تا کارت سیگنال را ببینید. اگر وصل نشد، دکمهٔ <span className="font-bold text-foreground">تست سلامت</span> دقیقاً می‌گوید کجای مسیر می‌شکند.</li>
        <li>⚠️ اگر خطای شبکه/فیلترینگ گرفتید: VPN را روی <span className="font-bold text-foreground">کل سیستم</span> روشن کنید (نه فقط مرورگر) یا دکمهٔ <span className="font-bold text-foreground">تشخیص خودکار پروکسی</span> را بزنید تا پورت برنامهٔ VPN شما (کلش/v2rayN) خودکار پیدا شود.</li>
      </ol>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="توکن بات: 123456789:AAE…"
          dir="ltr"
          className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-500/60"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="شمارهٔ مالک: 09123633595"
          dir="ltr"
          className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-500/60"
        />
        <input
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="پروکسی HTTP (اختیاری — برای تحریم): http://127.0.0.1:7890"
          dir="ltr"
          className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-sky-500/60 sm:col-span-2"
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" dir="rtl">
        <button onClick={doSave} disabled={busy !== ""} aria-busy={busy === "save"}
          className="flex items-center gap-1 rounded-md bg-sky-500/15 px-2.5 py-1.5 text-[10px] font-bold text-sky-400 ring-1 ring-sky-500/40 hover:bg-sky-500/25 disabled:opacity-60">
          <Link2 className="h-3 w-3" aria-hidden /> {busy === "save" ? "در حال ذخیره…" : "ذخیرهٔ توکن"}
        </button>
        <button onClick={doConnect} disabled={busy !== ""} aria-busy={busy === "connect"}
          className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-60">
          <Unplug className="h-3 w-3" aria-hidden /> {busy === "connect" ? "در حال اتصال…" : "اتصال"}
        </button>
        <button onClick={doHealth} disabled={busy !== ""} aria-busy={busy === "health"}
          className="flex items-center gap-1 rounded-md bg-violet-500/10 px-2.5 py-1.5 text-[10px] font-bold text-violet-400 ring-1 ring-violet-500/40 hover:bg-violet-500/20 disabled:opacity-60">
          <Stethoscope className="h-3 w-3" aria-hidden /> {busy === "health" ? "در حال تست…" : "تست سلامت"}
        </button>
        <button onClick={doScan} disabled={busy !== ""} aria-busy={busy === "scan"}
          className="flex items-center gap-1 rounded-md bg-fuchsia-500/10 px-2.5 py-1.5 text-[10px] font-bold text-fuchsia-400 ring-1 ring-fuchsia-500/40 hover:bg-fuchsia-500/20 disabled:opacity-60">
          <Radar className="h-3 w-3" aria-hidden /> {busy === "scan" ? "در حال جست‌وجو…" : "تشخیص خودکار پروکسی"}
        </button>
        <button onClick={doTest} disabled={busy !== ""} aria-busy={busy === "test"}
          className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-400 ring-1 ring-amber-500/40 hover:bg-amber-500/20 disabled:opacity-60">
          <Send className="h-3 w-3" aria-hidden /> {busy === "test" ? "در حال ارسال…" : "ارسال تست"}
        </button>
        <button onClick={doSummary} disabled={busy !== ""} aria-busy={busy === "summary"}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:text-foreground disabled:opacity-60">
          {busy === "summary" ? "در حال ارسال…" : "📊 ارسال گزارش عملکرد"}
        </button>
        <button onClick={showPreview} disabled={busy !== ""}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground ring-1 ring-border hover:text-foreground disabled:opacity-60">
          <ImageIcon className="h-3 w-3" aria-hidden /> پیش‌نمایش تصویر سیگنال
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5" dir="rtl">
        <Toggle k="enabled" label="پوش فعال" />
        <Toggle k="autoSignals" label="سیگنال‌ها خودکار" />
        <Toggle k="autoResults" label="نتایج خودکار" />
        <Toggle k="autoDaily" label="گزارش روزانه" />
      </div>

      {msg && (
        <div className={`mt-2 rounded-md px-2.5 py-1.5 text-[10px] leading-4 ring-1 ${
          msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
            : msg.kind === "err" ? "bg-red-500/10 text-red-400 ring-red-500/30"
              : "bg-sky-500/10 text-sky-400 ring-sky-500/30"
        }`} dir="rtl">{msg.text}</div>
      )}

      {health && (
        <div className="mt-2 space-y-1 rounded-md bg-secondary/40 px-2.5 py-2 ring-1 ring-border" dir="rtl">
          <div className="text-[10px] font-bold text-foreground">🩺 نتیجهٔ تست سلامت:</div>
          {([
            ["اتصال به سرور تلگرام", health.network],
            ["توکن ربات", health.token],
            ["چت مقصد", health.chat],
            ["وب‌هوک", health.webhook],
          ] as const).map(([label, row]) => (
            <div key={label} className="flex items-start gap-1.5 text-[10px] leading-4">
              <span className={row.ok ? "text-emerald-400" : "text-red-400"}>{row.ok ? "✓" : "✗"}</span>
              <span className={row.ok ? "text-muted-foreground" : "text-red-400"}>
                <b className="text-foreground">{label}:</b> {row.detail}
              </span>
            </div>
          ))}
        </div>
      )}

      {st?.tokenMasked && (
        <div className="mt-1.5 text-[9px] text-muted-foreground" dir="rtl">
          توکن فعال: <span className="font-mono" dir="ltr">{st.tokenMasked}</span>
          {st.ownerPhone ? <> · شمارهٔ مالک: <span className="font-mono" dir="ltr">{st.ownerPhone}</span></> : null}
        </div>
      )}

      {previewUrl && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border" dir="ltr">
          { }
          <img src={previewUrl} alt="نمونهٔ تصویر سیگنال تلگرام" className="w-full" />
        </div>
      )}
    </CollapsibleCard>
  );
}

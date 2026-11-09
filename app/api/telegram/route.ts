/**
 * Telegram integration endpoint.
 *
 * GET  ?action=status                  → connection status (token masked)
 * GET  ?action=preview&sym&tf&…levels  → rendered signal-chart PNG
 *
 * POST { action: "save" }    → save token / owner phone / toggles
 * POST { action: "connect" } → getMe + capture chat id from a /start message
 * POST { action: "test" }    → send a sample signal card to the chat
 * POST { action: "sync" }    → poll commands (/start, /stats, /help)
 * POST { action: "summary" } → push the performance report now
 */

import { NextRequest, NextResponse } from "next/server";
import { loadBrain } from "@/lib/ai/brain";
import type { AIVerdict } from "@/lib/smc/ai-types";
import { computePerformance } from "@/lib/smc/performance";
import { SYMBOLS, TF_IDS, TF_LABEL, type TFId } from "@/lib/smc/symbols";
import { getSnapshot } from "@/lib/smc/server";
import {
  loadTg, saveTg, maskToken, tgApi, tgSendPhoto, pushStats, tgHealth,
  formatSignalText, signalChartPng, scanLocalProxies, parseToken, getMeResilient,
} from "@/lib/telegram/telegram";
import type { ChartLevel } from "@/lib/telegram/png";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HELP_TEXT =
  "<b>SMC SNIPER BOT</b>\n" +
    "/start — اتصال این چت به اپ\n" +
    "/stats — گزارش عملکرد (سود/زیان، نرخ برد، افت سرمایه)\n" +
    "/help — همین راهنما\n\n" +
  "بعد از اتصال، سیگنال خرید/فروش (ورود، استاپ، تارگت‌ها، دلایل AI، حجم و DOM + تصویر چارت) و نتیجهٔ هر پوزیشن خودکار ارسال می‌شود.";

/** Never let a corrupt side-file crash the whole route — return JSON instead. */
function brainHistorySafe() {
  try {
    return loadBrain().history;
  } catch {
    return [];
  }
}

async function snapshotFor(sym: string | null, tf: string | null) {
  const cfg = SYMBOLS.find((s) => s.id === sym) ?? SYMBOLS[0];
  const tfId = (TF_IDS as readonly string[]).includes(tf ?? "") ? (tf as TFId) : "1h";
  const data = await getSnapshot(cfg);
  const tfSnap = data.tfs[tfId] ?? data.tfs["1h"];
  return { cfg, tfId, data, candles: tfSnap.candles ?? [] };
}

export async function GET(req: NextRequest) {
  try {
    return await handleGet(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `خطای داخلی سرور — اگر فایل‌ها را تازه جایگزین کرده‌اید، سرور را خاموش/روشن کنید. (${String(e).slice(0, 160)})` }, { status: 500 });
  }
}

async function handleGet(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");

  if (action === "preview") {
    try {
      const { cfg, tfId, candles } = await snapshotFor(sp.get("sym"), sp.get("tf"));
      const levels: ChartLevel[] = [];
      const pick = (k: string) => {
        const v = parseFloat(sp.get(k) ?? "");
        return isFinite(v) ? v : null;
      };
      const entry = pick("entry");
      const stop = pick("stop");
      const tp1 = pick("tp1");
      const tp2 = pick("tp2");
      if (entry != null) levels.push({ price: entry, color: "#2962ff", label: "ENTRY" });
      if (stop != null) levels.push({ price: stop, color: "#ef5350", label: "SL" });
      if (tp1 != null) levels.push({ price: tp1, color: "#26a69a", label: "TP1" });
      if (tp2 != null) levels.push({ price: tp2, color: "#ffb300", label: "TP2" });
      const png = signalChartPng({
        symbolLabel: cfg.name,
        tfLabel: TF_LABEL[tfId] ?? tfId,
        signal: (sp.get("side") === "BUY" ? "BUY" : "SELL"),
        candles,
        digits: cfg.digits,
        entry, stop, tp1, tp2,
        rr1: null,
        confidence: 0,
      });
      return new NextResponse(new Uint8Array(png), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // default: status — NEVER calls the Telegram API (it must stay instant even
  // when api.telegram.org is blocked; network checks live in ?action=health)
  const tg = loadTg();
  const check = sp.get("check") === "1";
  let botUsername: string | null = tg.botUsername || null;
  let tokenOk: boolean | null = null;
  if (check && tg.token) {
    const me = await tgApi<{ username?: string }>(tg.token, "getMe", undefined, tg.proxy);
    if (me.ok && me.result) {
      botUsername = `@${me.result.username}`;
      tokenOk = true;
      saveTg({ ...tg, botUsername });
    } else {
      tokenOk = false;
    }
  }
  return NextResponse.json(
    {
      connected: !!(tg.token && tg.chatId),
      tokenSaved: !!tg.token,
      tokenMasked: maskToken(tg.token),
      tokenOk,
      hasChat: !!tg.chatId,
      botUsername,
      proxy: tg.proxy || null,
      ownerPhone: tg.ownerPhone,
      enabled: tg.enabled,
      autoSignals: tg.autoSignals,
      autoResults: tg.autoResults,
      autoDaily: tg.autoDaily,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: `خطای داخلی سرور — اگر فایل‌ها را تازه جایگزین کرده‌اید، سرور را خاموش/روشن کنید. (${String(e).slice(0, 160)})` }, { status: 500 });
  }
}

async function handlePost(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  const action = String(body.action ?? "");
  const tg = loadTg();

  if (action === "scan-proxy") {
    const res = await scanLocalProxies();
    if (res.found) {
      saveTg({ ...tg, proxy: res.found });
      return NextResponse.json({ ok: true, proxy: res.found, message: `پروکسی محلی پیدا و ذخیره شد: ${res.found} — حالا «اتصال» را بزنید.` });
    }
    return NextResponse.json({
      ok: false,
      error: "هیچ پروکسی HTTP محلی روی پورت‌های رایج (۷۸۹۰ کلش، ۱۰۸۰۹ v2rayN، ۲۰۸۰ sing-box و…) پیدا نشد. دو راه دارید: ۱) VPN را روی «کل سیستم» روشن کنید (حالت TUN) و دوباره «اتصال» را بزنید؛ ۲) برنامهٔ VPN خود (کلش/v2rayN) را باز کنید و پورت HTTP آن را در کادر «پروکسی» به شکل http://127.0.0.1:پورت وارد و ذخیره کنید.",
    });
  }

  if (action === "save") {
    const next = { ...tg };
    if (typeof body.token === "string" && body.token.trim()) {
      const parsed = parseToken(body.token);
      if (!parsed.token) {
        return NextResponse.json({ ok: false, error: parsed.error ?? "توکن نامعتبر است." }, { status: 400 });
      }
      next.token = parsed.token;
      next.botUsername = ""; // re-verify on next connect — never keep a stale name for a new token
    }
    if (typeof body.ownerPhone === "string") next.ownerPhone = body.ownerPhone.trim();
    const proxyWas = tg.proxy || "";
    if (typeof body.proxy === "string") next.proxy = body.proxy.trim();
    for (const k of ["enabled", "autoSignals", "autoResults", "autoDaily"] as const) {
      if (typeof body[k] === "boolean") next[k] = body[k] as boolean;
    }
    if (!saveTg(next)) {
      return NextResponse.json({
        ok: false,
        error: "ذخیره روی دیسک شکست خورد (پوشهٔ data قابل نوشتن نیست). اگر اپ روی VPS/لینوکس است، دسترسی پوشهٔ data را چک کنید؛ روی ویندوز، اپ را از داخل پوشهٔ استخراج‌شدهٔ واقعی اجرا کنید — نه از یک مسیر موقت.",
      }, { status: 500 });
    }
    const proxyNow = next.proxy || "";
    let message = next.token && typeof body.token === "string" && body.token.trim() ? "توکن ذخیره شد — حالا دکمهٔ «اتصال» را بزنید."
      : proxyNow !== proxyWas ? (proxyNow ? `پروکسی ذخیره شد: ${proxyNow} — حالا دکمهٔ «اتصال» را بزنید.` : "پروکسی حذف شد — اتصال مستقیم امتحان می‌شود.")
        : "تنظیمات ذخیره شد.";
    return NextResponse.json({ ok: true, tokenMasked: maskToken(next.token), proxy: next.proxy || null, message });
  }

  if (action === "health") {
    const h = await tgHealth(tg.token, tg.chatId, tg.proxy);
    return NextResponse.json({ ok: h.network.ok && h.token.ok && h.chat.ok && h.webhook.ok, health: h });
  }

  if (action === "connect") {
    if (!tg.token) return NextResponse.json({ ok: false, kind: "no-token", error: "ابتدا توکن بات را در کادر بالا وارد و «ذخیرهٔ توکن» را بزنید." }, { status: 400 });
    // Resilient getMe: saved proxy → direct retry → auto-scan. A dead saved
    // proxy used to fail EVERY button; now the route repairs itself.
    const res = await getMeResilient(tg.token, tg.proxy);
    // persist the proxy repair FIRST — even when getMe itself failed (bad
    // token): a dead saved proxy must never survive a connect attempt
    const liveProxy = res.proxyUsed ?? "";
    if (res.proxyChanged) saveTg({ ...loadTg(), proxy: liveProxy });
    const me = res.me;
    if (!me.ok || !me.result) {
      return NextResponse.json(
        { ok: false, kind: me.kind ?? "api", error: me.description ?? "getMe ناموفق بود." },
        { status: 400 }
      );
    }
    const proxyForCalls = res.proxyChanged ? liveProxy : tg.proxy; // never reuse a proxy the resilient pass just disproved
    const botUsername = `@${me.result.username}`;
    const upd = await tgApi<Array<{ update_id: number; message?: { chat: { id: number; type?: string; first_name?: string }; text?: string } }>>(
      tg.token, "getUpdates", { offset: 0, timeout: 0, allowed_updates: ["message"] }, proxyForCalls
    );
    if (!upd.ok) {
      return NextResponse.json({ ok: false, kind: upd.kind ?? "api", error: upd.description ?? "خواندن پیام‌ها ناموفق بود." }, { status: 400 });
    }
    let chatId: string | null = null;
    let chatName = "";
    let maxUpdate = tg.lastUpdateId;
    // prefer an explicit /start (or /stats), but accept ANY private message —
    // the chat being open is what matters for the push
    for (const u of upd.result ?? []) {
      maxUpdate = Math.max(maxUpdate, u.update_id);
      const msg = u.message;
      if (!msg) continue;
      const text = (msg.text ?? "").trim();
      if (msg.chat.type && msg.chat.type !== "private") continue;
      if (text.startsWith("/start") || text.startsWith("/stats")) {
        chatId = String(msg.chat.id);
        chatName = msg.chat.first_name ?? "";
      } else if (!chatId) {
        chatId = String(msg.chat.id);
        chatName = msg.chat.first_name ?? "";
      }
    }
    if (!chatId) {
      saveTg({ ...tg, botUsername, lastUpdateId: maxUpdate, proxy: res.proxyChanged ? liveProxy : tg.proxy });
      return NextResponse.json({
        ok: false,
        needsStart: true,
        botUsername,
        error: `تلگرام وصل است و ربات ${botUsername} معتبر است، اما این ربات هنوز هیچ پیامی از شما ندارد. در تلگرام به ${botUsername} بروید، دکمهٔ START را بزنید (یا هر پیامی بفرستید) و بعد دوباره «اتصال» را بزنید.`,
      });
    }
    saveTg({ ...tg, chatId, botUsername, enabled: true, lastUpdateId: maxUpdate, proxy: res.proxyChanged ? liveProxy : tg.proxy });
    await tgApi(tg.token, "sendMessage", {
      chat_id: chatId,
      text: `✅ <b>اتصال برقرار شد</b>${chatName ? ` — ${chatName}` : ""}\n\n${HELP_TEXT}`,
      parse_mode: "HTML",
    }, proxyForCalls);
    return NextResponse.json({
      ok: true, chatId, botUsername,
      proxyUsed: res.proxyUsed,
      proxyChanged: res.proxyChanged,
    });
  }

  if (action === "test") {
    if (!(tg.token && tg.chatId)) {
      return NextResponse.json({ ok: false, error: "ابتدا توکن را ذخیره و اتصال را کامل کنید." }, { status: 400 });
    }
    try {
      const { cfg, tfId, candles } = await snapshotFor(
        typeof body.sym === "string" ? body.sym : null,
        typeof body.tf === "string" ? body.tf : null
      );
      // sample levels around price so the demo chart has lines
      const price = candles.length ? candles[candles.length - 1].c : cfg.digits === 5 ? 1.08 : 3900;
      const sampleVerdict: AIVerdict = {
        signal: "SELL",
        confidence: 68,
        entry: price,
        stop: 0, tp1: 0, tp2: null,
        timeframe: tfId,
        flowRead: "test",
        reasoning: ["پیام تست اتصال — این یک سیگنال واقعی نیست."],
        invalidation: "—",
      };
      const step = price * (cfg.group === "FX" ? 0.0015 : 0.008);
      sampleVerdict.stop = price + step;
      sampleVerdict.tp1 = price - step * 1.5;
      sampleVerdict.tp2 = price - step * 2.5;
      const caption =
        `🧪 <b>پیام تست اتصال</b> — ${cfg.name} ${TF_LABEL[tfId]}\n` +
        `اگر این کارت و تصویر چارت را می‌بینید، پوش سیگنال‌ها آماده است.\n` +
        `<i>سطوح زیر نمونهٔ نمایشی است، نه سیگنال واقعی.</i>\n` +
        formatSignalText({
          symbolName: `${cfg.name} (نمونه)`,
          tfLabel: TF_LABEL[tfId] ?? tfId,
          verdict: { ...sampleVerdict, signal: "SELL" },
          rr1: 1.5, rr2: 2.5,
          price,
          consensusLine: "تست اتصال",
          votes: [],
          flowLine: "—",
          domLine: null,
          now: Date.now(),
        });
      const png = signalChartPng({
        symbolLabel: cfg.name,
        tfLabel: TF_LABEL[tfId] ?? tfId,
        signal: "SELL",
        candles,
        digits: cfg.digits,
        entry: sampleVerdict.entry,
        stop: sampleVerdict.stop,
        tp1: sampleVerdict.tp1,
        tp2: sampleVerdict.tp2,
        rr1: 1.5,
        confidence: 68,
      });
      const sent = await tgSendPhoto(tg.token, tg.chatId, png, caption, tg.proxy);
      return NextResponse.json({ ok: sent.ok, error: sent.ok ? undefined : sent.description });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
    }
  }

  if (action === "sync") {
    if (!(tg.token && tg.chatId)) return NextResponse.json({ ok: true, handled: [] });
    const upd = await tgApi<Array<{ update_id: number; message?: { chat: { id: number }; text?: string } }>>(
      tg.token, "getUpdates", { offset: tg.lastUpdateId + 1, timeout: 0, allowed_updates: ["message"] }, tg.proxy
    );
    const handled: string[] = [];
    let maxUpdate = tg.lastUpdateId;
    if (upd.ok && upd.result) {
      for (const u of upd.result) {
        maxUpdate = Math.max(maxUpdate, u.update_id);
        const text = (u.message?.text ?? "").trim();
        const chatId = u.message ? String(u.message.chat.id) : "";
        if (!chatId) continue;
        if (text.startsWith("/start")) {
          saveTg({ ...loadTg(), chatId, enabled: true });
          await tgApi(tg.token, "sendMessage", { chat_id: chatId, text: HELP_TEXT, parse_mode: "HTML" }, tg.proxy);
          handled.push("start");
        } else if (text.startsWith("/stats")) {
          const stats = computePerformance({ real: brainHistorySafe(), demo: [] });
          await pushStats(stats);
          handled.push("stats");
        } else if (text.startsWith("/help")) {
          await tgApi(tg.token, "sendMessage", { chat_id: chatId, text: HELP_TEXT, parse_mode: "HTML" }, tg.proxy);
          handled.push("help");
        }
      }
      if (maxUpdate !== tg.lastUpdateId) saveTg({ ...loadTg(), lastUpdateId: maxUpdate });
    }
    return NextResponse.json({ ok: true, handled, networkError: upd.kind === "network" ? upd.description : undefined });
  }

  if (action === "summary") {
    if (!(tg.token && tg.chatId)) {
      return NextResponse.json({ ok: false, error: "اتصال تلگرام کامل نیست." }, { status: 400 });
    }
    const stats = computePerformance({ real: brainHistorySafe(), demo: [] });
    const r = await pushStats(stats);
    return NextResponse.json(r);
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}

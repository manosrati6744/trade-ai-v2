/**
 * Telegram push — signals, results and daily performance reports.
 *
 * The bot cannot text a bare phone number (Telegram's Bot API only accepts
 * chat IDs, and bots may never start a chat). So the flow is:
 *   1) user pastes the BotFather token into the app,
 *   2) user presses START on the bot from their own account (the phone
 *      number is stored as the owner's reference),
 *   3) the app captures the chat id via getUpdates and pushes everything:
 *      signals (entry/SL/TPs + AI reasoning + volume/DOM + chart PNG),
 *      closed-trade results, and a daily performance summary.
 */

import fs from "fs";
import path from "path";
import http from "node:http";
import tls from "node:tls";
import type { JournalEntry } from "@/lib/ai/brain";
import type { AIVerdict } from "@/lib/smc/ai-types";
import type { PerfStats } from "@/lib/smc/performance";
import type { Candle } from "@/lib/smc/engine";
import { renderCandlePng, type ChartLevel } from "@/lib/telegram/png";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const TG_FILE = path.join(DATA_DIR, "telegram.json");

export interface TgSettings {
  token: string;
  chatId: string;
  ownerPhone: string;
  /** Optional HTTP proxy for api.telegram.org (sanctions/filtering), e.g. http://127.0.0.1:7890 */
  proxy: string;
  botUsername: string;
  enabled: boolean;
  autoSignals: boolean;
  autoResults: boolean;
  autoDaily: boolean;
  lastDaily: string; // YYYY-MM-DD of last daily summary
  lastSignalKey: string;
  lastUpdateId: number;
}

const DEFAULTS: TgSettings = {
  token: "",
  chatId: "",
  ownerPhone: "09123633595",
  proxy: "",
  botUsername: "",
  enabled: false,
  autoSignals: true,
  autoResults: true,
  autoDaily: true,
  lastDaily: "",
  lastSignalKey: "",
  lastUpdateId: 0,
};

export function loadTg(): TgSettings {
  try {
    if (!fs.existsSync(TG_FILE)) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(TG_FILE, "utf8")) as Partial<TgSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTg(s: TgSettings): boolean {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = TG_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, TG_FILE);
    return true;
  } catch {
    return false; // caller must tell the user — silent success here = «قبول نمی‌کند» loops
  }
}

export const maskToken = (t: string) => (t ? `${t.slice(0, 8)}…${t.slice(-4)}` : "");

/** Persian display names for the tradable symbols. */
export const FA_SYMBOL: Record<string, string> = {
  XAUUSD: "طلا (GOLD)",
  USOIL: "نفت وست تگزاس (WTI)",
  EURUSD: "یورو/دلار (EURUSD)",
  GBPUSD: "پوند/دلار (GBPUSD)",
  USDJPY: "دلار/ین (USDJPY)",
};

/* ------------------------------ Bot API --------------------------------- */

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  /** "network" | "bad-token" | "webhook" | "api" | undefined (ok=true) */
  kind?: string;
}

/** Settings-level proxy or env fallback (HTTP proxies only, e.g. Clash/V2Ray http port). */
export function resolveProxy(cfg?: string | null): string | null {
  const p = (cfg ?? "").trim() || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
  return p.trim() || null;
}

/**
 * Extract a clean bot token from a messy paste. Strips ALL whitespace and
 * invisible/bidi characters (ZWNJ/ZWJ, RTL marks, BOM — they sneak in when the
 * token is copied out of a Persian Telegram chat) anywhere in the string, then
 * pulls the numeric-id:secret pattern out of any surrounding label text.
 * Returns null (with a Persian reason) when no token-shaped text survives —
 * the caller must NOT silently save garbage, that is what created the
 * «هر چی میزنم قبول نمیکنه» loop.
 */
export function parseToken(raw: string): { token: string | null; error?: string } {
  const bare = String(raw ?? "")
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/^[`"'«\[\(]+|[`"'»\]\)]+$/g, "");
  const m = bare.match(/(\d{5,12}:[A-Za-z0-9_-]{20,})/);
  if (m) return { token: m[1] };
  if (!bare) return { token: null, error: "کادر توکن خالی است." };
  if (/^\+?\d{8,14}$/.test(bare))
    return { token: null, error: "این یک شمارهٔ تلفن است، نه توکن ربات — توکن از @BotFather می‌آید و شبیه 123456789:AAE… است." };
  if (/^https?:\/\//i.test(bare))
    return { token: null, error: "این یک لینک است، نه توکن ربات — در تلگرام به @BotFather پیام دهید، /mybots → API Token را باز کنید و رشتهٔ توکن را کپی کنید." };
  return {
    token: null,
    error: "این متن شبیه توکن بات تلگرام نیست. توکن باید به شکل 123456789:AAExxxxxx باشد (عدد، دو نقطه، حروف لاتین). از @BotFather با /mybots دوباره کپی کنید و مطمئن شوید کل رشته آمده باشد.",
  };
}

/** Lenient client-side cleanup (same invisible-char strip, no validation). */
export function sanitizeToken(raw: string): string {
  const bare = String(raw ?? "")
    .replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/^[`"'«\[\(]+|[`"'»\]\)]+$/g, "");
  const m = bare.match(/(\d{5,12}:[A-Za-z0-9_-]{20,})/);
  return m ? m[1] : bare;
}

/** Persian explanation for a raw network failure — the #1 cause is api.telegram.org being blocked. */
export function netErrorFa(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; message?: string; code?: string };
  const code = err?.cause?.code ?? err?.code ?? "";
  const raw = `${err?.message ?? String(e)} ${err?.cause?.message ?? ""}`;
  if (/socks/i.test(raw))
    return "پروکسی از نوع SOCKS پشتیبانی نمی‌شود — در برنامهٔ شما (کلش/v2rayN) پورت HTTP را پیدا کنید و به شکل http://127.0.0.1:پورت وارد کنید (مثال: http://127.0.0.1:7890).";
  if (/proxy refused CONNECT|ECONNRESET.*proxy|connect ECONNREFUSED/i.test(raw) || code === "ECONNREFUSED")
    return "اتصال به پروکسی/شبکه رد شد — اگر پروکسی وارد کرده‌اید، آدرس و پورت آن را چک کنید (مثال: http://127.0.0.1:7890). وگرنه VPN کل سیستم را روشن کنید. دکمهٔ «تشخیص خودکار پروکسی» هم می‌تواند پورت درست را پیدا کند.";
  if (/proxy refused/i.test(raw))
    return "پروکسی به درخواست اتصال به تلگرام جواب «رد» داد — پورت HTTP برنامهٔ VPN خود را وارد کنید (نه پورت SOCKS)، مثال: http://127.0.0.1:7890";
  if (code === "ENOTFOUND" || /getaddrinfo|ENOTFOUND/i.test(raw))
    return "سرور api.telegram.org پیدا نشد (DNS بسته است) — این خطا یعنی تحریم/فیلترینگ. VPN را روی «کل سیستم» روشن کنید (نه فقط مرورگر) یا یک پروکسی HTTP در کادر «پروکسی» بگذارید و دوباره امتحان کنید.";
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(raw))
    return "زمان انتظار برای سرور تلگرام تمام شد — درخواست به مقصد نرسید (فیلترینگ/تحریم). VPN کل سیستم، پروکسی HTTP یا دکمهٔ «تشخیص خودکار پروکسی» لازم است.";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET" || /fetch failed|socket/i.test(raw))
    return "اتصال وسط راه قطع شد — api.telegram.org مسدود است. VPN کل سیستم را روشن کنید یا پروکسی HTTP وارد کنید.";
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || /certificate|ssl/i.test(raw))
    return "خطای گواهی SSL — ساعت و تاریخ سیستم را چک کنید یا VPN/پروکسی را عوض کنید.";
  if (/Invalid URL|unsupported scheme/i.test(raw))
    return "آدرس پروکسی معتبر نیست — فرمت درست: http://127.0.0.1:7890";
  return raw.slice(0, 220) || "خطای ناشناختهٔ شبکه";
}

/* ------------------------- proxy tunnel (no deps) -------------------------
 * HTTP-over-HTTP-proxy via CONNECT + TLS using node built-ins only — so the
 * app NEVER needs an extra npm install for the proxy feature to work.
 * ------------------------------------------------------------------------ */

interface TunnelResult { status: number; text: string; }

function tunnelRequest(proxyUrl: string, targetUrl: string, method: string, headers: Record<string, string>, body: Buffer | null, timeoutMs: number): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err: Error | null, res?: TunnelResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (err) reject(err); else resolve(res!);
    };
    const guard = setTimeout(() => { sockRef.destroy(); done(new Error("timeout — پاسخی از سرور تلگرام (یا پروکسی) نرسید")); }, timeoutMs);

    const pUrl = new URL(proxyUrl);
    const tUrl = new URL(targetUrl);
    const port = Number(pUrl.port) || (pUrl.protocol === "https:" ? 443 : 80);
    const req = http.request({
      host: pUrl.hostname,
      port,
      method: "CONNECT",
      path: `${tUrl.hostname}:443`,
      headers: { Host: `${tUrl.hostname}:443` },
      setHost: false,
    });
    const sockRef: { destroy(): void } = { destroy: () => req.destroy() };
    req.setTimeout(timeoutMs, () => { req.destroy(new Error("timeout — پروکسی جواب CONNECT نداد")); });
    req.on("error", (e) => done(e instanceof Error ? e : new Error(String(e))));
    req.on("connect", (res, socket) => {
      sockRef.destroy = () => socket.destroy();
      if (res.statusCode !== 200) {
        socket.destroy();
        done(new Error(`proxy refused CONNECT (${res.statusCode})`));
        return;
      }
      const tlsSocket = tls.connect({ socket, servername: tUrl.hostname }, () => {
        const head =
          `${method} ${tUrl.pathname}${tUrl.search} HTTP/1.1\r\n` +
          `Host: ${tUrl.hostname}\r\n` +
          `Connection: close\r\n` +
          `Accept: application/json\r\n` +
          Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n" +
          (body ? `Content-Length: ${body.length}\r\n` : "") +
          "\r\n";
        tlsSocket.write(head);
        if (body) tlsSocket.write(body);
      });
      tlsSocket.setTimeout(timeoutMs, () => { tlsSocket.destroy(); done(new Error("timeout — پاسخ از سرور تلگرام نرسید")); });
      let buf = Buffer.alloc(0);
      let headerDone = false;
      let status = 0;
      let wantLength = -1;
      let chunked = false;
      tlsSocket.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (!headerDone) {
          const idx = buf.indexOf("\r\n\r\n");
          if (idx < 0) return;
          headerDone = true;
          const headStr = buf.subarray(0, idx).toString("utf8");
          status = parseInt(headStr.split(" ")[1] ?? "0", 10) || 0;
          for (const line of headStr.split("\r\n").slice(1)) {
            const c = line.indexOf(":");
            if (c < 0) continue;
            const k = line.slice(0, c).trim().toLowerCase();
            const v = line.slice(c + 1).trim();
            if (k === "content-length") wantLength = parseInt(v, 10);
            if (k === "transfer-encoding" && /chunked/i.test(v)) chunked = true;
          }
          if (status === 204 || method === "HEAD") tlsSocket.end();
        }
        const bodyBuf = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
        const complete =
          wantLength >= 0 ? bodyBuf.length >= wantLength
            : chunked ? bodyBuf.toString("latin1").endsWith("0\r\n\r\n")
              : false; // wait for connection close (we sent Connection: close)
        if (complete) { tlsSocket.end(); }
      });
      tlsSocket.on("end", () => tlsSocket.destroy());
      tlsSocket.on("close", () => {
        if (!headerDone) { done(new Error("timeout — پروکسی socket را بست بی‌آنکه پاسخی برسد")); return; }
        const raw = buf.subarray(buf.indexOf("\r\n\r\n") + 4);
        const payload = chunked ? dechunk(raw) : raw;
        done(null, { status, text: payload.toString("utf8") });
      });
      tlsSocket.on("error", (e) => done(e instanceof Error ? e : new Error(String(e))));
    });
    req.end();
  });
}

/** Minimal chunked-transfer decoder for the tunnel path. */
function dechunk(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf("\r\n", i);
    if (nl < 0) break;
    const size = parseInt(buf.subarray(i, nl).toString("latin1").split(";")[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(nl + 2, Math.min(nl + 2 + size, buf.length)));
    i = nl + 2 + size + 2;
  }
  return Buffer.concat(out);
}

interface RawHttp { status: number; text: string; }

/** POST to the Bot API: native fetch when direct, manual CONNECT tunnel when a proxy is set. */
async function tgPost(targetUrl: string, headers: Record<string, string>, body: Buffer | null, timeoutMs: number, proxy: string | null): Promise<RawHttp> {
  if (proxy) {
    if (!/^https?:\/\//i.test(proxy)) {
      throw new Error(`socks or invalid proxy scheme — فقط پروکسی HTTP (http://…) پشتیبانی می‌شود`);
    }
    return tunnelRequest(proxy, targetUrl, "POST", headers, body, timeoutMs);
  }
  const r = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: (body ?? undefined) as unknown as BodyInit,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, text: await r.text() };
}

function buildMultipart(fields: { name: string; value: string | Buffer; filename?: string; ctype?: string }[]): { body: Buffer; contentType: string } {
  const boundary = "----smcsniper" + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const f of fields) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"` +
      (f.filename ? `; filename="${f.filename}"` : "") + "\r\n" +
      (f.ctype ? `Content-Type: ${f.ctype}\r\n` : "") + "\r\n"
    ));
    parts.push(Buffer.isBuffer(f.value) ? Buffer.from(f.value) : Buffer.from(f.value, "utf8"));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function classifyHttp(status: number, description: string): { kind: string; fa?: string } {
  if (status === 401 || status === 404)
    return { kind: "bad-token", fa: "توکن ربات نامعتبر است — از @BotFather با /mybots توکن را دوباره کپی کنید (کامل و بدون فاصلهٔ اضافه)." };
  if (status === 409)
    return { kind: "webhook", fa: "روی این ربات وب‌هوک فعال است و مانع خواندن پیام‌ها می‌شود — در BotFather پیام /mybots → Bot Settings → Webhook → Delete webhook، یا /deletehook را بفرستید." };
  if (status === 429)
    return { kind: "api", fa: "تلگرام محدودیت ارسال زده (تعداد پیام زیاد) — چند ثانیه صبر کنید." };
  return { kind: "api" };
}

async function tgApi<T>(token: string, method: string, body?: Record<string, unknown>, proxy?: string | null, timeoutMs = 15_000): Promise<TgResponse<T>> {
  const pr = resolveProxy(proxy);
  try {
    const r = await tgPost(`https://api.telegram.org/bot${token}/${method}`, {
      "Content-Type": "application/json",
    }, body ? Buffer.from(JSON.stringify(body), "utf8") : null, timeoutMs, pr);
    let j: TgResponse<T>;
    try {
      j = JSON.parse(r.text) as TgResponse<T>;
    } catch {
      return { ok: false, kind: "network", description: `پاسخ غیرمنتظره از مسیر تلگرام (HTTP ${r.status}) — اگر پروکسی/VPN دارید، پورت HTTP آن را بدهید.` };
    }
    if (!j.ok && r.status !== 200) {
      const c = classifyHttp(r.status, j.description ?? "");
      return { ok: false, kind: c.kind, description: c.fa ?? `${j.description ?? "خطای تلگرام"} (HTTP ${r.status})` };
    }
    if (!j.ok) return { ...j, kind: "api" };
    return j;
  } catch (e) {
    return { ok: false, kind: "network", description: netErrorFa(e) };
  }
}

/**
 * getMe that refuses to die on one stale setting: try the saved proxy first;
 * if it fails at NETWORK level but a proxy was set, retry WITHOUT proxy (a
 * leftover dead proxy must never poison every button); if that also fails,
 * scan common local VPN ports once and use the winner. Returns which proxy
 * actually worked so the caller can persist the repair.
 */
export async function getMeResilient(token: string, savedProxy: string | null): Promise<{
  me: TgResponse<{ id: number; username?: string }>;
  proxyUsed: string | null; // proxy that worked (null = direct)
  proxyChanged: boolean;    // true when settings should be updated
}> {
  const pr = resolveProxy(savedProxy);
  let me = await tgApi<{ id: number; username?: string }>(token, "getMe", undefined, pr);
  if (me.ok) return { me, proxyUsed: pr, proxyChanged: false };
  if (me.kind === "network" && pr) {
    const direct = await tgApi<{ id: number; username?: string }>(token, "getMe", undefined, null);
    if (direct.ok) return { me: direct, proxyUsed: null, proxyChanged: true };
    // any non-network reply (401 bad token, 404…) proves the direct path reaches
    // Telegram — the saved proxy is dead AND unnecessary, so drop it either way
    if (direct.kind !== "network") return { me: direct, proxyUsed: null, proxyChanged: true };
    me = direct; // keep the direct-error detail (more useful than the proxy one)
  }
  if (me.kind === "network") {
    const scan = await scanLocalProxies();
    if (scan.found) {
      const via = await tgApi<{ id: number; username?: string }>(token, "getMe", undefined, scan.found);
      if (via.ok) return { me: via, proxyUsed: scan.found, proxyChanged: true };
    }
  }
  return { me, proxyUsed: pr, proxyChanged: false };
}

async function tgSendPhoto(token: string, chatId: string, png: Buffer, caption: string, proxy?: string | null): Promise<TgResponse<unknown>> {
  const pr = resolveProxy(proxy);
  try {
    const mp = buildMultipart([
      { name: "chat_id", value: chatId },
      { name: "caption", value: caption.slice(0, 1024) },
      { name: "parse_mode", value: "HTML" },
      { name: "photo", value: png, filename: "signal.png", ctype: "image/png" },
    ]);
    const r = await tgPost(`https://api.telegram.org/bot${token}/sendPhoto`, { "Content-Type": mp.contentType }, mp.body, 30_000, pr);
    let j: TgResponse<unknown>;
    try {
      j = JSON.parse(r.text) as TgResponse<unknown>;
    } catch {
      return { ok: false, kind: "network", description: `پاسخ غیرمنتظره از مسیر تلگرام (HTTP ${r.status}) — اگر پروکسی/VPN دارید، پورت HTTP آن را بدهید.` };
    }
    if (!j.ok && r.status !== 200) {
      const c = classifyHttp(r.status, j.description ?? "");
      return { ok: false, kind: c.kind, description: c.fa ?? `${j.description ?? "خطای تلگرام"} (HTTP ${r.status})` };
    }
    if (!j.ok) return { ...j, kind: "api" };
    return j;
  } catch (e) {
    return { ok: false, kind: "network", description: netErrorFa(e) };
  }
}

/* ------------------------------ health check ---------------------------- */

export interface TgHealth {
  network: { ok: boolean; detail: string };
  token: { ok: boolean; detail: string };
  chat: { ok: boolean; detail: string };
  webhook: { ok: boolean; detail: string };
}

/** Structured self-test: reachability → token → chat binding → webhook conflict. */
export async function tgHealth(token: string, chatId: string, proxy?: string | null): Promise<TgHealth> {
  const out: TgHealth = {
    network: { ok: false, detail: "" },
    token: { ok: false, detail: "" },
    chat: { ok: false, detail: "" },
    webhook: { ok: false, detail: "" },
  };
  if (!token) {
    out.network.detail = "بدون توکن — فقط دسترسی شبکه بررسی می‌شود.";
    const ping = await tgApi("123:network-probe", "getMe", undefined, proxy);
    out.network = ping.kind === "bad-token" || ping.kind === "webhook"
      ? { ok: true, detail: "اتصال به سرور تلگرام برقرار است ✓" }
      : { ok: false, detail: ping.description ?? "اتصال برقرار نشد" };
    out.token.detail = "توکن ذخیره نشده — از BotFather توکن را کپی و ذخیره کنید.";
    out.chat.detail = "بدون توکن قابل بررسی نیست.";
    out.webhook.detail = "بدون توکن قابل بررسی نیست.";
    return out;
  }
  const me = await tgApi<{ id: number; username?: string }>(token, "getMe", undefined, proxy);
  const viaTxt = resolveProxy(proxy) ? ` (با پروکسی فعلی ${resolveProxy(proxy)})` : "";
  out.network = me.kind === "network"
    ? { ok: false, detail: `${me.description ?? "اتصال به api.telegram.org برقرار نشد."}${viaTxt}` }
    : { ok: true, detail: "اتصال به سرور تلگرام برقرار است ✓" };
  if (me.ok && me.result) {
    out.token = { ok: true, detail: `توکن معتبر است — ربات @${me.result.username} ✓` };
    if (chatId) {
      const chat = await tgApi(token, "getChat", { chat_id: chatId }, proxy);
      if (chat.ok) {
        const c = chat.result as { first_name?: string; title?: string } | undefined;
        out.chat = { ok: true, detail: `چت متصل است — ${c?.first_name ?? c?.title ?? chatId} ✓` };
      } else {
        out.chat = { ok: false, detail: chat.description ?? "چت در دسترس نیست." };
      }
    } else {
      out.chat = { ok: false, detail: "هنوز چت متصل نشده — از ربات START بزنید و «اتصال» را بزنید." };
    }
    const wh = await tgApi<{ url: string }>(token, "getWebhookInfo", undefined, proxy);
    if (wh.ok && wh.result) {
      out.webhook = wh.result.url
        ? { ok: false, detail: `وب‌هوک فعال است (${wh.result.url}) و پیام‌ها را می‌بلعد — در BotFather /deletehook بفرستید.` }
        : { ok: true, detail: "وب‌هوکی روی ربات نیست — خواندن پیام‌ها آزاد است ✓" };
    } else {
      out.webhook = { ok: false, detail: wh.description ?? "بررسی وب‌هوک ناموفق بود." };
    }
  } else {
    out.token = { ok: false, detail: me.description ?? "توکن نامعتبر است." };
    out.chat.detail = me.kind === "network" ? "بدون شبکه قابل بررسی نیست." : "توکن معتبر نیست؛ ابتدا توکن را درست کنید.";
    out.webhook.detail = me.kind === "network" ? "بدون شبکه قابل بررسی نیست." : "توکن معتبر نیست؛ ابتدا توکن را درست کنید.";
  }
  return out;
}

/* ------------------------------ proxy auto-detect ------------------------ */

/** Common local HTTP-proxy ports: Clash, Clash Verge, sing-box, v2rayN, privoxy, squid, generic. */
const COMMON_PROXY_PORTS = [7890, 7897, 7899, 2080, 10809, 8118, 3128, 8888, 8080];

/**
 * Try a real getMe through each local port. A 401 from api.telegram.org proves
 * the tunnel works (the dummy token is invalid on purpose) — first port that
 * gets any real Telegram HTTP response wins.
 */
export async function scanLocalProxies(): Promise<{ found: string | null; tried: { proxy: string; ok: boolean }[] }> {
  const tried: { proxy: string; ok: boolean }[] = [];
  for (const port of COMMON_PROXY_PORTS) {
    const proxy = `http://127.0.0.1:${port}`;
    const r = await tgApi("1:probe", "getMe", undefined, proxy, 4000);
    const ok = r.ok || r.kind === "bad-token" || r.kind === "webhook" || r.kind === "api";
    tried.push({ proxy, ok });
    if (ok) return { found: proxy, tried };
  }
  return { found: null, tried };
}

/* ------------------------------ captions -------------------------------- */

const FA_SIDE = (s: "BUY" | "SELL" | "WAIT") =>
  s === "BUY" ? "🟢 <b>سیگنال خرید</b> 📈" : s === "SELL" ? "🔴 <b>سیگنال فروش</b> 📉" : "⏸ <b>انتظار</b>";

const faTime = (ts: number) =>
  new Date(ts).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });

const num = (v: number | null, d = 2) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

export interface SignalPushInput {
  symbolName: string; // «طلا (GOLD)»
  tfLabel: string; // «4H»
  verdict: AIVerdict;
  rr1: number | null;
  rr2: number | null;
  price: number;
  consensusLine: string; // «فروش 50% — ۴ رأی فروش، ۱ رأی خرید»
  votes: { fa: string; agree: 1 | 0 | -1; detail: string }[];
  flowLine: string; // «خرید 38% | فروش 62% — سمت فروش»
  domLine: string | null; // دیوار حجمی / ایمبالنس
  now: number;
}

export function formatSignalText(m: SignalPushInput): string {
  const v = m.verdict;
  const side = v.signal === "BUY" ? "خرید" : "فروش";
  const voteLines = m.votes
    .map((x) => `${x.agree > 0 ? "✅" : x.agree < 0 ? "⚠️" : "➖"} ${x.fa}: ${x.detail}`)
    .join("\n");
  const reasons = (v.reasoning ?? []).slice(0, 4).map((x) => `• ${x}`).join("\n");
  return (
    `${FA_SIDE(v.signal)}\n` +
    `💎 <b>${m.symbolName}</b> · تایم‌فریم <b>${m.tfLabel}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎯 <b>نقطه ورود:</b> <code>${num(v.entry)}</code>\n` +
    `🛑 <b>استاپ لاس:</b> <code>${num(v.stop)}</code>\n` +
    `✅ <b>تارگت ۱:</b> <code>${num(v.tp1)}</code>${m.rr1 != null ? ` (RR ${m.rr1.toFixed(1)})` : ""}\n` +
    (v.tp2 != null ? `🏆 <b>تارگت ۲:</b> <code>${num(v.tp2)}</code>${m.rr2 != null ? ` (RR ${m.rr2.toFixed(1)})` : ""}\n` : "") +
    `━━━━━━━━━━━━━━━\n` +
    `🤖 اطمینان AI: <b>${v.confidence}%</b>\n` +
    `🧭 اجماع سیستم: ${m.consensusLine}\n` +
    `${voteLines}\n` +
    `📊 حجم و عمق بازار (DOM):\n` +
    `${m.flowLine}\n` +
    (m.domLine ? `${m.domLine}\n` : "") +
    `━━━━━━━━━━━━━━━\n` +
    `🧠 <b>دلایل هوش مصنوعی:</b>\n${reasons}\n` +
    `⛔️ <b>شرط ابطال:</b> ${v.invalidation}\n` +
    `🕒 ${faTime(m.now)} — داده زنده TradingView\n` +
    `<i>پوزیشن‌گیری مسئولانه؛ این سیگنال تحلیل ماشینی است.</i>`
  );
}

export function formatResultText(j: JournalEntry, statsLine: string): string {
  const isWin = j.outcome === "win";
  const icon = isWin ? "🟢 برد" : j.outcome === "loss" ? "🔴 باخت" : j.outcome === "expired" ? "⌛️ منقضی" : "✖️ لغو";
  const side = j.side === "LONG" ? "خرید 📈" : "فروش 📉";
  return (
    `${icon} — <b>پوزیشن ${side} بسته شد</b>\n` +
    `💎 ${j.symbol} · ورود <code>${num(j.entry)}</code> → خروج <code>${num(j.exitPrice ?? null)}</code>\n` +
    (j.outcome === "win" ? `✅ هدف ۱ برخورد شد: <code>${num(j.tp1)}</code>\n` : j.outcome === "loss" ? `🛑 استاپ لاس خورد: <code>${num(j.stop)}</code>\n` : "") +
    `━━━━━━━━━━━━━━━\n` +
    `📚 ژورنال: ${statsLine}\n` +
    `🕒 ${faTime(j.tClosed ?? Date.now())}`
  );
}

export function formatStatsText(s: PerfStats): string {
  const wr = s.winRate == null ? "—" : `${s.winRate.toFixed(1)}%`;
  const bucket = (b: { trades: number; pnl: number; r: number } | null) =>
    b && b.trades ? `${b.pnl >= 0 ? "+" : "−"}${Math.abs(b.pnl).toFixed(1)} pt (${b.r >= 0 ? "+" : "−"}${Math.abs(b.r).toFixed(1)}R)` : "بدون معامله";
  return (
    `📊 <b>گزارش عملکرد SMC SNIPER</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 <b>سود/زیان خالص:</b> ${s.netPnl >= 0 ? "+" : "−"}${Math.abs(s.netPnl).toFixed(2)} pt (${s.netR >= 0 ? "+" : "−"}${Math.abs(s.netR).toFixed(2)}R)\n` +
    `🎯 <b>نرخ برد:</b> ${wr} — ${s.wins} برد / ${s.losses} باخت\n` +
    `⚖️ <b>پروفیت فاکتور:</b> ${s.profitFactor == null ? "—" : s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}\n` +
    `📈 <b>انتظار ریاضی:</b> ${s.expectancyR == null ? "—" : `${s.expectancyR >= 0 ? "+" : "−"}${Math.abs(s.expectancyR).toFixed(2)}R`}\n` +
    `📉 <b>حداکثر افت سرمایه:</b> ${s.maxDDr.toFixed(2)}R\n` +
    `━━━━━━━━━━━━━━━\n` +
    `▲ <b>خرید:</b> ${s.longs.n} معامله — نرخ برد ${s.longs.winRate == null ? "—" : `${s.longs.winRate.toFixed(0)}%`} (${s.longs.r >= 0 ? "+" : "−"}${Math.abs(s.longs.r).toFixed(1)}R)\n` +
    `▼ <b>فروش:</b> ${s.shorts.n} معامله — نرخ برد ${s.shorts.winRate == null ? "—" : `${s.shorts.winRate.toFixed(0)}%`} (${s.shorts.r >= 0 ? "+" : "−"}${Math.abs(s.shorts.r).toFixed(1)}R)\n` +
    `⏳ باز: ${s.open} · بسته: ${s.closed}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `☀️ <b>امروز:</b> ${bucket(s.today)}\n` +
    `📅 <b>این ماه:</b> ${bucket(s.mtd)}\n` +
    `🗓 <b>امسال:</b> ${bucket(s.ytd)}\n` +
    (s.worstDay ? `🔻 <b>بدترین روز:</b> ${s.worstDay.label} (${s.worstDay.pnl.toFixed(1)} pt)\n` : "") +
    `<i>${faTime(s.generatedAt)}</i>`
  );
}

/* ------------------------------ chart image ----------------------------- */

export function signalChartPng(opts: {
  symbolLabel: string; // "GOLD"
  tfLabel: string; // "4H"
  signal: "BUY" | "SELL";
  candles: Candle[];
  digits: number;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr1: number | null;
  confidence: number;
}): Buffer {
  const levels: ChartLevel[] = [];
  if (opts.entry != null) levels.push({ price: opts.entry, color: "#2962ff", label: "ENTRY" });
  if (opts.stop != null) levels.push({ price: opts.stop, color: "#ef5350", label: "SL" });
  if (opts.tp1 != null) levels.push({ price: opts.tp1, color: "#26a69a", label: "TP1" });
  if (opts.tp2 != null) levels.push({ price: opts.tp2, color: "#ffb300", label: "TP2" });
  return renderCandlePng({
    title: `${opts.symbolLabel} ${opts.tfLabel} ${opts.signal}`,
    subtitle: `SMC SNIPER · AI ${opts.confidence}%${opts.rr1 != null ? ` · RR ${opts.rr1.toFixed(1)}` : ""}`,
    candles: opts.candles,
    levels,
    digits: opts.digits,
  });
}

/* ------------------------------ push helpers ---------------------------- */

export interface PushTargets {
  symbolName: string;
  symbolLabel: string;
  tfLabel: string;
  tfId: string;
  candles: Candle[];
  digits: number;
}

/** Fire-and-forget signal push — never throws into the main request. */
export async function pushSignal(
  m: SignalPushInput,
  chart: PushTargets
): Promise<{ ok: boolean; error?: string }> {
  const tg = loadTg();
  if (!tg.enabled || !tg.token || !tg.chatId || !tg.autoSignals) return { ok: false, error: "disabled" };
  if (m.verdict.signal !== "BUY" && m.verdict.signal !== "SELL") return { ok: false, error: "no-signal" };
  if (m.verdict.entry == null || m.verdict.stop == null || m.verdict.tp1 == null) {
    return { ok: false, error: "no-levels" };
  }
  const key = `${chart.symbolLabel}-${chart.tfId}-${m.verdict.signal}-${m.verdict.entry.toFixed(4)}`;
  if (key === tg.lastSignalKey) return { ok: false, error: "duplicate" };
  saveTg({ ...tg, lastSignalKey: key });

  const caption = formatSignalText(m);
  const png = signalChartPng({
    symbolLabel: chart.symbolLabel,
    tfLabel: chart.tfLabel,
    signal: m.verdict.signal,
    candles: chart.candles,
    digits: chart.digits,
    entry: m.verdict.entry,
    stop: m.verdict.stop,
    tp1: m.verdict.tp1,
    tp2: m.verdict.tp2,
    rr1: m.rr1,
    confidence: m.verdict.confidence,
  });
  const photo = await tgSendPhoto(tg.token, tg.chatId, png, caption, tg.proxy);
  if (!photo.ok) {
    // fallback: text-only so the owner never misses a signal
    await tgApi(tg.token, "sendMessage", {
      chat_id: tg.chatId,
      text: caption.slice(0, 4096),
      parse_mode: "HTML",
    }, tg.proxy);
  }
  // full reasoning follows as a separate text message (caption limit is tight)
  const detail =
    `🧠 <b>تحلیل کامل</b> — ${chart.symbolLabel} ${chart.tfLabel} ${m.verdict.signal}\n` +
    (m.verdict.reasoning ?? []).map((x) => `• ${x}`).join("\n") +
    `\n\n<i>flow: ${m.verdict.flowRead}</i>`;
  await tgApi(tg.token, "sendMessage", { chat_id: tg.chatId, text: detail.slice(0, 4096), parse_mode: "HTML" }, tg.proxy);
  return { ok: photo.ok, error: photo.ok ? undefined : photo.description };
}

export async function pushResult(j: JournalEntry, statsLine: string): Promise<{ ok: boolean; error?: string }> {
  const tg = loadTg();
  if (!tg.enabled || !tg.token || !tg.chatId || !tg.autoResults) return { ok: false, error: "disabled" };
  const r = await tgApi(tg.token, "sendMessage", {
    chat_id: tg.chatId,
    text: formatResultText(j, statsLine),
    parse_mode: "HTML",
  }, tg.proxy);
  return { ok: r.ok, error: r.ok ? undefined : r.description };
}

export async function pushStats(s: PerfStats): Promise<{ ok: boolean; error?: string }> {
  const tg = loadTg();
  if (!tg.enabled || !tg.token || !tg.chatId) return { ok: false, error: "not-configured" };
  const r = await tgApi(tg.token, "sendMessage", {
    chat_id: tg.chatId,
    text: formatStatsText(s),
    parse_mode: "HTML",
  }, tg.proxy);
  return { ok: r.ok, error: r.ok ? undefined : r.description };
}

/** Daily summary — call from the periodic analysis poll; sends once per local day. */
export async function maybeDailyStats(compute: () => PerfStats): Promise<void> {
  const tg = loadTg();
  if (!tg.enabled || !tg.token || !tg.chatId || !tg.autoDaily) return;
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
  if (tg.lastDaily === today) return;
  saveTg({ ...tg, lastDaily: today });
  await pushStats(compute());
}

export { tgApi, tgSendPhoto };

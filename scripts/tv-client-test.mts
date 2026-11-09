// Direct test of the TV client logic (mirrors src/lib/tv/client.ts)
import WebSocket from "ws";

type BarV = [number, number, number, number, number, number];
type SeriesEl = { i: number; v?: unknown } | [number, { i?: number; v?: unknown }];

const TV_WS_URL = "wss://data.tradingview.com/socket.io/websocket";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface ResSpec { tf: string; res: string; bars: number }
interface SessionState extends ResSpec { csId: string; bars: Map<number, unknown[]>; completed: boolean; failed: string | null }

function frame(p: string) { return `~m~${Buffer.byteLength(p)}~m~${p}`; }
function randId(prefix: string) { let s = ""; const c = "abcdefghijklmnopqrstuvwxyz0123456789"; for (let i = 0; i < 12; i++) s += c[Math.floor(Math.random() * c.length)]; return prefix + s; }
function normalizeBar(el: SeriesEl) {
  const b = Array.isArray(el) ? el[1] : el;
  if (!b || !Array.isArray(b.v) || b.v.length < 6) return null;
  const [t, o, h, l, c, v] = b.v as number[];
  if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) return null;
  return { i: Number(b.i), v: [t, o, h, l, c, isFinite(v) ? v : 0] as BarV };
}

function fetchTradingViewCandles(tvSymbol: string, specs: ResSpec[], timeoutMs = 12000): Promise<Record<string, unknown[][]>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TV_WS_URL, { origin: "https://www.tradingview.com", headers: { "User-Agent": UA }, handshakeTimeout: 8000 });
    const sessions: SessionState[] = specs.map((r) => ({ ...r, csId: randId("cs_"), candles: new Map(), completed: false, failed: null }));
    let finished = false;
    const finishTimer = setTimeout(() => finish("timeout"), timeoutMs);
    const finish = (reason?: string) => {
      if (finished) return;
      finished = true; clearTimeout(finishTimer);
      try { ws.close(); } catch {}
      const series: Record<string, unknown[][]> = {}; const failed: Record<string, string> = {}; let usable = 0;
      for (const s of sessions) {
        const arr = [...s.candles.values()].sort((a: any, b: any) => a[0] - b[0]);
        if (!s.failed && arr.length >= 40) { series[s.tf] = arr; usable++; } else failed[s.tf] = s.failed ?? `only ${arr.length} bars`;
      }
      if (usable === 0) reject(new Error(`TV: no usable data${reason ? ` (${reason})` : ""} ${JSON.stringify(failed)}`));
      else resolve(series);
    };
    const sendRaw = (p: string) => { try { ws.send(frame(p)); } catch {} };
    const sendMsg = (m: string, p: unknown[]) => sendRaw(JSON.stringify({ m, p }));
    ws.on("open", () => {
      sendMsg("set_auth_token", ["unauthorized_user_token"]);
      for (const s of sessions) {
        sendMsg("chart_create_session", [s.csId, ""]);
        sendMsg("resolve_symbol", [s.csId, "sds_sym_1", `={"adjustment":"splits","symbol":"${tvSymbol}"}`]);
        sendMsg("create_series", [s.csId, "sds_1", "s1", "sds_sym_1", s.res, s.bars, ""]);
      }
    });
    ws.on("message", (data: Buffer) => {
      const raw = data.toString();
      const re = /~m~(\d+)~m~/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw))) {
        const start = m.index + m[0].length;
        const payload = raw.slice(start, start + Number(m[1]));
        if (payload.startsWith("~h~")) { sendRaw(payload); continue; }
        let j: any; try { j = JSON.parse(payload); } catch { continue; }
        if (!j || typeof j !== "object" || typeof j.m !== "string") continue;
        if (j.m === "timescale_update" || j.m === "du") {
          const s = sessions.find((x) => x.csId === j.p?.[0]);
          if (!s) continue;
          const dataObj = j.p?.[1];
          if (!dataObj || typeof dataObj !== "object") continue;
          for (const [key, obj] of Object.entries<any>(dataObj)) {
            if (!/^sds_/.test(key) || !obj || !Array.isArray(obj.s)) continue;
            for (const el of obj.s) {
              const bar = normalizeBar(el);
              if (!bar) continue;
              s.candles.set(bar.i, bar.v);
            }
          }
        } else if (j.m === "series_completed") {
          const s = sessions.find((x) => x.csId === j.p?.[0]);
          if (s) { s.completed = true; if (sessions.every((x) => x.completed || x.failed)) setTimeout(() => finish(), 700); }
        } else if (j.m === "symbol_error" || j.m === "critical_error" || j.m === "protocol_error") {
          const s = sessions.find((x) => x.csId === j.p?.[0]);
          const msg = String(j.p?.[2] ?? j.p?.[1] ?? j.m);
          if (s) s.failed = msg; else for (const x of sessions) x.failed ??= msg;
          if (sessions.every((x) => x.failed)) finish("error");
        }
      }
    });
    ws.on("error", (e: Error) => { for (const s of sessions) s.failed ??= e.message; finish("socket error"); });
    ws.on("close", () => finish("socket closed"));
  });
}

const t0 = Date.now();
try {
  const series = await fetchTradingViewCandles("OANDA:XAUUSD", [
    { tf: "5m", res: "5", bars: 300 },
    { tf: "15m", res: "15", bars: 300 },
    { tf: "30m", res: "30", bars: 300 },
    { tf: "1h", res: "60", bars: 300 },
    { tf: "1d", res: "1D", bars: 3 },
  ], 12000);
  console.log("OK in", Date.now() - t0, "ms");
  for (const [k, v] of Object.entries(series)) {
    const last = v[v.length - 1] as BarV;
    console.log(`${k}: ${v.length} bars, last: t=${last[0]} c=${last[4]} v=${last[5]}`);
  }
} catch (e) {
  console.error("FAILED in", Date.now() - t0, "ms:", (e as Error).message);
}
process.exit(0);

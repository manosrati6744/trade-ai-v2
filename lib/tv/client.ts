/**
 * TradingView unofficial WebSocket client.
 *
 * Connects to wss://data.tradingview.com/socket.io/websocket and speaks the
 * legacy `~m~<len>~m~` framed protocol to pull candle history + realtime bar
 * updates (du) for any public TradingView symbol — no API key required.
 *
 * Message shape observed (2026 server release):
 *   timescale_update  p = [csId, { sds_1: { s: [{ i, v: [t,o,h,l,c,v] }] } }, timescale]
 *   du                p = [csId, { sds_1: { s: [{ i, v: [...] }] , ns, ...} }]
 *   series_completed  p = [csId, "sds_1", "streaming", "s1", {...}]
 */

import WebSocket from "ws";
import type { Candle } from "@/lib/smc/engine";

const TV_WS_URL = "wss://data.tradingview.com/socket.io/websocket";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type BarV = [number, number, number, number, number, number];
type SeriesEl = { i: number; v?: unknown } | [number, { i?: number; v?: unknown }];

interface ResSpec {
  tf: string; // output timeframe id, e.g. "5m"
  res: string; // TradingView resolution, e.g. "5"
  bars: number;
}

interface SessionState extends ResSpec {
  csId: string;
  candles: Map<number, Candle>;
  completed: boolean;
  failed: string | null;
}

export interface TVFetchResult {
  series: Record<string, Candle[]>;
  failed: Record<string, string>;
}

function frame(payload: string): string {
  return `~m~${Buffer.byteLength(payload)}~m~${payload}`;
}

function randId(prefix: string): string {
  let s = "";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + s;
}

function normalizeBar(el: SeriesEl): { i: number; v: BarV } | null {
  const b = Array.isArray(el) ? el[1] : el;
  if (!b || !Array.isArray(b.v) || b.v.length < 6) return null;
  const [t, o, h, l, c, v] = b.v as number[];
  if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) return null;
  return { i: Number(b.i), v: [t, o, h, l, c, isFinite(v) ? v : 0] };
}

/**
 * Fetch candle series for one TradingView symbol across several resolutions.
 * Opens a single socket with one chart session per resolution.
 * Resolves as soon as every session completes (plus a short grace for the
 * latest `du` ticks); rejects only if no session produced usable data.
 */
export function fetchTradingViewCandles(
  tvSymbol: string,
  specs: ResSpec[],
  timeoutMs = 12_000
): Promise<TVFetchResult> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(TV_WS_URL, {
        origin: "https://www.tradingview.com",
        headers: { "User-Agent": UA },
        handshakeTimeout: 8_000,
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error("ws init failed"));
      return;
    }

    const sessions: SessionState[] = specs.map((r) => ({
      ...r,
      csId: randId("cs_"),
      candles: new Map(),
      completed: false,
      failed: null,
    }));

    let finished = false;
    let finishTimer: NodeJS.Timeout | undefined = setTimeout(() => finish("timeout"), timeoutMs);

    const finish = (reason?: string) => {
      if (finished) return;
      finished = true;
      if (finishTimer) clearTimeout(finishTimer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      const series: Record<string, Candle[]> = {};
      const failed: Record<string, string> = {};
      let usable = 0;
      for (const s of sessions) {
        const arr = [...s.candles.values()].sort((a, b) => a.t - b.t);
        if (!s.failed && arr.length >= 40) {
          series[s.tf] = arr;
          usable++;
        } else {
          failed[s.tf] = s.failed ?? `only ${arr.length} bars`;
        }
      }
      if (usable === 0) {
        reject(new Error(`TradingView: no usable data${reason ? ` (${reason})` : ""}`));
      } else {
        resolve({ series, failed });
      }
    };

    const sendRaw = (payload: string) => {
      try {
        ws.send(frame(payload));
      } catch {
        /* socket gone */
      }
    };
    const sendMsg = (m: string, p: unknown[]) => sendRaw(JSON.stringify({ m, p }));

    ws.on("open", () => {
      sendMsg("set_auth_token", ["unauthorized_user_token"]);
      for (const s of sessions) {
        sendMsg("chart_create_session", [s.csId, ""]);
        sendMsg("resolve_symbol", [
          s.csId,
          "sds_sym_1",
          `={"adjustment":"splits","symbol":"${tvSymbol}"}`,
        ]);
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
        if (payload.startsWith("~h~")) {
          sendRaw(payload); // echo heartbeat back verbatim
          continue;
        }
        let j: { m?: string; p?: unknown[] };
        try {
          j = JSON.parse(payload);
        } catch {
          continue;
        }
        if (!j || typeof j !== "object" || typeof j.m !== "string") continue;

        if (j.m === "timescale_update" || j.m === "du") {
          const csId = j.p?.[0];
          const s = sessions.find((x) => x.csId === csId);
          if (!s) continue;
          const dataObj = j.p?.[1] as Record<string, { s?: SeriesEl[] }> | undefined;
          if (!dataObj || typeof dataObj !== "object") continue;
          for (const [key, obj] of Object.entries(dataObj)) {
            if (!/^sds_/.test(key) || !obj || !Array.isArray(obj.s)) continue;
            for (const el of obj.s) {
              const bar = normalizeBar(el);
              if (!bar) continue;
              s.candles.set(bar.i, {
                t: bar.v[0],
                o: bar.v[1],
                h: bar.v[2],
                l: bar.v[3],
                c: bar.v[4],
                v: bar.v[5],
              });
            }
          }
        } else if (j.m === "series_completed") {
          const s = sessions.find((x) => x.csId === j.p?.[0]);
          if (s) {
            s.completed = true;
            if (sessions.every((x) => x.completed || x.failed)) {
              // short grace so the very latest forming bar (du) is merged
              setTimeout(() => finish(), 700);
            }
          }
        } else if (
          j.m === "symbol_error" ||
          j.m === "series_error" ||
          j.m === "critical_error" ||
          j.m === "protocol_error"
        ) {
          const csId = j.p?.[0];
          const s = sessions.find((x) => x.csId === csId);
          const msg = String(j.p?.[3] ?? j.p?.[2] ?? j.p?.[1] ?? j.m);
          if (s) s.failed = msg;
          else for (const x of sessions) x.failed ??= msg;
          if (sessions.every((x) => x.failed)) finish("error");
        }
      }
    });

    ws.on("error", (e: Error) => {
      for (const s of sessions) s.failed ??= e.message;
      finish("socket error");
    });

    ws.on("close", () => finish("socket closed"));
  });
}

/**
 * Shared AI-message types — safe to import from client components
 * (no node/fs dependencies here).
 */

export type AIMessageKind = "entry" | "exit" | "note";

export type AIMessageSignal = "BUY" | "SELL" | "WAIT" | "EXIT" | "NOTE";

export type AIMessageOutcome = "win" | "loss" | "expired" | "superseded" | "open";

/** Compact annotated-chart payload the AI ships with every signal message. */
export interface MessageChart {
  timeframe: string;
  bars: {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
  }[];
  /** per-bar buy/sell volume aligned with `bars` (DOM-style delta drawing) */
  flow: { buy: number; sell: number }[];
  marks: {
    entry?: number | null;
    stop?: number | null;
    tp1?: number | null;
    tp2?: number | null;
    /** planned entry zone [bottom, top] */
    zone?: [number, number] | null;
    zoneKind?: "demand" | "supply" | null;
    /** actual exit price (exit messages) */
    exit?: number | null;
    /** candle index of the entry bar (exit messages) */
    entryK?: number | null;
    events?: { k: number; price: number; type: string; dir: string }[];
    obs?: { kind: string; top: number; bottom: number; k: number }[];
    trend?: string;
    divergence?: "bullish" | "bearish" | "none";
  };
}

/** One entry in the AI message feed (the AI's "chat" with the user). */
export interface AIMessage {
  id: string;
  symbol: string;
  t: number; // epoch ms
  kind: AIMessageKind;
  signal: AIMessageSignal;
  outcome?: AIMessageOutcome;
  confidence: number;
  timeframe: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  /** realized move % for exit messages */
  pnlPct?: number | null;
  /** held duration ms for exit messages */
  heldMs?: number | null;
  flowRead: string;
  /** the AI's reasoning chain — "دلیل" */
  reasoning: string[];
  invalidation: string;
  /** brain factor emphasis at decision time */
  factors?: { flow: number; structure: number; mtf: number; zone: number };
  brainVersion: number;
  chart: MessageChart | null;
}

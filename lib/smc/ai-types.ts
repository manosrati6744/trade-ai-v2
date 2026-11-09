/** Shared types for the SNIPER AI verdict served by /api/ai. */

export interface AIVerdict {
  signal: "BUY" | "SELL" | "WAIT";
  confidence: number;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  timeframe: string;
  flowRead: string;
  reasoning: string[];
  invalidation: string;
}

export interface AIStats {
  version: number;
  tracked: number;
  open: number;
  accuracy: number | null;
  wins: number;
  losses: number;
  factors: Record<string, number>;
  notes: string[];
}

export interface AIResponse {
  verdict: AIVerdict;
  engine: boolean;
  brain: AIStats;
  generatedAt: number;
  error?: string;
}

export interface SymbolConfig {
  id: string;
  name: string;
  yahoo: string;
  tv: string;
  digits: number;
  group: "METAL" | "ENERGY" | "FX";
}

export const SYMBOLS: SymbolConfig[] = [
  { id: "XAUUSD", name: "GOLD", yahoo: "GC=F", tv: "OANDA:XAUUSD", digits: 2, group: "METAL" },
  { id: "USOIL", name: "WTI OIL", yahoo: "CL=F", tv: "TVC:USOIL", digits: 2, group: "ENERGY" },
  { id: "EURUSD", name: "EUR/USD", yahoo: "EURUSD=X", tv: "OANDA:EURUSD", digits: 5, group: "FX" },
  { id: "GBPUSD", name: "GBP/USD", yahoo: "GBPUSD=X", tv: "OANDA:GBPUSD", digits: 5, group: "FX" },
  { id: "USDJPY", name: "USD/JPY", yahoo: "USDJPY=X", tv: "OANDA:USDJPY", digits: 3, group: "FX" },
];

export const TF_IDS = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;
export type TFId = (typeof TF_IDS)[number];

export const TF_LABEL: Record<string, string> = {
  "5m": "5M",
  "15m": "15M",
  "30m": "30M",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
};

/** TradingView widget interval for the embedded advanced chart. */
export const TF_TV_INTERVAL: Record<string, string> = {
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "D",
};

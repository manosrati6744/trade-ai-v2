/**
 * FA — Persian rendering helpers for everything the AI "says".
 *
 * Engine values stay English ("bullish", "buyers", "BOS"…) because they are
 * used in logic/comparisons; these helpers map them to Persian only for the
 * text that reaches the user. Numbers and technical abbreviations
 * (BOS, CHoCH, OB, FVG, RR, SL, TP, MTF) intentionally stay Latin — that is
 * how traders read them on charts.
 */

export function faTrend(t: string | null | undefined): string {
  switch (t) {
    case "bullish":
      return "صعودی";
    case "bearish":
      return "نزولی";
    case "ranging":
      return "خنثی (رِنج)";
    default:
      return "نامشخص";
  }
}

export function faDir(d: string | null | undefined): string {
  switch (d) {
    case "buyers":
      return "خریداران";
    case "sellers":
      return "فروشندگان";
    case "balanced":
      return "متعادل";
    case "up":
    case "bullish":
      return "صعودی";
    case "down":
    case "bearish":
      return "نزولی";
    default:
      return "—";
  }
}

export function faDivergence(d: string | null | undefined): string {
  switch (d) {
    case "bullish":
      return "واگرایی صعودی";
    case "bearish":
      return "واگرایی نزولی";
    default:
      return "";
  }
}

export function faSignal(s: string | null | undefined): string {
  switch (s) {
    case "STRONG BUY":
      return "خرید قوی";
    case "BUY":
      return "خرید";
    case "NEUTRAL":
      return "خنثی";
    case "SELL":
      return "فروش";
    case "STRONG SELL":
      return "فروش قوی";
    default:
      return "—";
  }
}

/** Long timeframe label — kept Latin (chart-standard), no mixed gloss. */
export function faTF(tf: string | null | undefined): string {
  return tf ?? "—";
}

/**
 * faBidi — bidi repair for mixed Persian/Latin trading text.
 *
 * Wraps signed numbers ("-16.5%", "+2.45%") and abbreviation=number pairs
 * ("RR1=1.5") in LRM marks (U+200E) so the sign/number/abbrev stay attached
 * and read left-to-right inside an RTL sentence. Invisible characters —
 * they only steer the Unicode BiDi algorithm.
 */
export function faBidi(s: string): string {
  return s
    .replace(/(^|[^\dA-Za-z])([+-]\d[\d.,/]*\s?[%٪]?)/g, "$1\u200E$2\u200E")
    .replace(
      /(^|[^\w\u0600-\u06FF])([A-Za-z]{1,4}\d?\s?[=:]\s?[-+]?[\d.,]+\s?[%٪]?)/g,
      "$1\u200E$2\u200E"
    );
}

/** Persian side word for a plan/position side. */
export function faSide(side: string | null | undefined): string {
  if (side === "LONG" || side === "BUY") return "خرید (LONG)";
  if (side === "SHORT" || side === "SELL") return "فروش (SHORT)";
  return "—";
}

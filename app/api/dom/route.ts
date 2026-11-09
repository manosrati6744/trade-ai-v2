/**
 * Live Depth-of-Market endpoint (LuxAlgo-style estimated DOM).
 *
 * GET /api/dom?symbol=XAUUSD          → book from the finest available TF
 * GET /api/dom?symbol=XAUUSD&tf=15m   → book built from that TF's candles
 * GET /api/dom?symbol=XAUUSD&tf=all   → one book per TF (5m/15m/30m/1h/4h)
 *
 * The book is built by src/lib/smc/dom.ts from the app's own live feed
 * (tick-volume pressure model, same idea as LuxAlgo) — shared with the
 * SNIPER AI payload so the model sees exactly what the DOM panel shows.
 */

import { NextRequest, NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/smc/symbols";
import { getSnapshot } from "@/lib/smc/server";
import { buildDomBook, pickDomCandles, DOM_TFS } from "@/lib/smc/dom";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const symId = req.nextUrl.searchParams.get("symbol") ?? "XAUUSD";
  const tf = req.nextUrl.searchParams.get("tf");
  const cfg = SYMBOLS.find((s) => s.id === symId);
  if (!cfg) {
    return NextResponse.json({ error: `Unknown symbol: ${symId}` }, { status: 400 });
  }

  try {
    const data = await getSnapshot(cfg);

    // tf=all — a full per-timeframe deep-market breakdown in one response
    if (tf === "all") {
      const books: Record<string, ReturnType<typeof buildDomBook> & { timeframe: string }> = {};
      for (const t of DOM_TFS) {
        const base = pickDomCandles(data.tfs, t);
        if (base) books[t] = { timeframe: t, ...buildDomBook(base.candles, data.price, data.digits) };
      }
      if (Object.keys(books).length === 0) {
        return NextResponse.json({ error: "No candle data" }, { status: 502 });
      }
      return NextResponse.json(
        {
          symbol: data.symbol,
          name: data.name,
          digits: data.digits,
          price: data.price,
          source: data.source,
          t: Date.now(),
          books,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // single book — requested TF if given (must exist), else finest available
    const base = pickDomCandles(data.tfs, tf);
    if (!base) {
      return NextResponse.json(
        { error: tf ? `No candle data for timeframe ${tf}` : "No candle data" },
        { status: 502 }
      );
    }

    const dom = buildDomBook(base.candles, data.price, data.digits);
    return NextResponse.json(
      {
        symbol: data.symbol,
        name: data.name,
        digits: data.digits,
        price: data.price,
        timeframe: base.tf,
        source: data.source,
        t: Date.now(),
        ...dom,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "DOM build failed" },
      { status: 502 }
    );
  }
}

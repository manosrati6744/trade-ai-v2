import { NextRequest, NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/smc/symbols";
import { getSnapshot } from "@/lib/smc/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const symId = req.nextUrl.searchParams.get("symbol") ?? "XAUUSD";
  const cfg = SYMBOLS.find((s) => s.id === symId);
  if (!cfg) {
    return NextResponse.json({ error: `Unknown symbol: ${symId}` }, { status: 400 });
  }
  try {
    const data = await getSnapshot(cfg);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch market data" },
      { status: 502 }
    );
  }
}

/**
 * AI message feed endpoint.
 *
 * GET /api/ai/messages?symbol=XAUUSD&limit=14
 *
 * Serves the persistent feed (entries with reasoning + chart, exits with
 * outcomes, brain self-update notes). Also opportunistically evaluates open
 * virtual positions against the live price so exit messages appear between
 * AI verdict refreshes.
 */

import { NextRequest, NextResponse } from "next/server";
import { SYMBOLS } from "@/lib/smc/symbols";
import { getSnapshot } from "@/lib/smc/server";
import { brainStats, loadBrain, refreshPositions } from "@/lib/ai/brain";
import { pushResult } from "@/lib/telegram/telegram";
import {
  appendMessage,
  buildExitMessage,
  buildNoteMessage,
  loadFeed,
} from "@/lib/ai/messages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const symId = req.nextUrl.searchParams.get("symbol") ?? "XAUUSD";
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "14", 10);
  const limit = Math.min(40, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 14));
  const cfg = SYMBOLS.find((s) => s.id === symId);
  if (!cfg) {
    return NextResponse.json({ error: `Unknown symbol: ${symId}` }, { status: 400 });
  }

  // Opportunistic exit evaluation against the live price (snapshot is cached).
  let note: string | undefined;
  try {
    const data = await getSnapshot(cfg);
    const { brain, resolved, prevVersion } = refreshPositions(symId, data.price);
    const stats = brainStats(brain);
    for (const j of resolved) {
      appendMessage(
        symId,
        buildExitMessage({
          journal: j,
          data,
          brainVersion: brain.version,
          record: { wins: stats.wins, losses: stats.losses, accuracy: stats.accuracy },
        })
      );
      // Telegram push for the closed trade (fire-and-forget)
      if (j.outcome !== "open") {
        void pushResult(
          j,
          `${stats.wins} برد / ${stats.losses} باخت — نرخ برد ${stats.accuracy ?? "—"}%`
        ).catch(() => {
          /* push failures must never break the feed */
        });
      }
    }
    if (brain.version > prevVersion) {
      appendMessage(
        symId,
        buildNoteMessage({
          symbol: symId,
          notes: brain.notes,
          brainVersion: brain.version,
          factors: stats.factors,
        })
      );
    }
  } catch (e) {
    note = `Live evaluation skipped (${e instanceof Error ? e.message : "market data unavailable"}) — showing stored feed.`;
  }

  const brain = brainStats(loadBrain());
  return NextResponse.json(
    {
      messages: loadFeed(symId, limit),
      brain: {
        version: brain.version,
        accuracy: brain.accuracy,
        tracked: brain.tracked,
        wins: brain.wins,
        losses: brain.losses,
        open: brain.open,
      },
      generatedAt: Date.now(),
      note,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

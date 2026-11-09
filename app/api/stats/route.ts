/**
 * Performance stats endpoint — international-standard trading metrics
 * computed from the AI brain's virtual journal.
 *
 * GET  → full PerfStats JSON (real journal + optional demo dataset).
 * POST → { action: "seed" | "clear" } manages the DEMO dataset. Demo rows
 *        live in their own file (perf-demo.json) and never touch the
 *        learning brain, tuning factors, or real journal entries.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { loadBrain, type JournalEntry } from "@/lib/ai/brain";
import {
  computePerformance,
  makeDemoEntries,
  type PerfStats,
} from "@/lib/smc/performance";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DEMO_FILE = path.join(DATA_DIR, "perf-demo.json");

function loadDemo(): JournalEntry[] {
  try {
    if (!fs.existsSync(DEMO_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(DEMO_FILE, "utf8")) as { entries?: JournalEntry[] };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const brain = loadBrain();
  const demo = loadDemo();
  const stats: PerfStats = computePerformance(
    { real: brain.history, demo },
    Date.now()
  );
  return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let action = "";
  try {
    const body = (await req.json()) as { action?: string };
    action = body.action ?? "";
  } catch {
    /* fallthrough */
  }

  if (action === "seed") {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        DEMO_FILE,
        JSON.stringify({ version: 1, generatedAt: Date.now(), entries: makeDemoEntries() })
      );
    } catch {
      return NextResponse.json({ ok: false, error: "storage unavailable" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, demo: true }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "clear") {
    try {
      if (fs.existsSync(DEMO_FILE)) fs.unlinkSync(DEMO_FILE);
    } catch {
      /* ignore */
    }
    return NextResponse.json({ ok: true, demo: false }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}

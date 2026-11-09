"use client";

/**
 * AI MESSAGES — the feed where SNIPER AI explains itself.
 *
 * Every entry signal arrives with its full reasoning chain AND a drawn
 * sketch of the decision (entry / SL / TP / zone / structure / volume).
 * Exits arrive when the virtual position resolves (TP hit, SL hit,
 * superseded, expired) with the realized outcome. Brain self-updates
 * appear as notes — so the user can study exactly how the AI behaves.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, MessageSquareText, RefreshCw, Radio, Trash2 } from "lucide-react";
import { fmtPrice } from "@/lib/smc/snapshot";
import type { AIMessage } from "@/lib/ai/types";
import {
  LIVE_KIND_CLS,
  LIVE_KIND_FA,
  clearLive,
  useLiveFeed,
  type LiveItem,
} from "@/lib/smc/livereport";
import SignalDiagram from "./SignalDiagram";
import FsButton from "./FsButton";
import CollapsibleCard from "./CollapsibleCard";
import { usePanelFs } from "@/hooks/use-panel-fs";

interface FeedResponse {
  messages: AIMessage[];
  brain: { version: number; accuracy: number | null; tracked: number; open: number };
  generatedAt: number;
  note?: string;
  error?: string;
}

interface Props {
  symbolId: string;
  digits: number;
}

const KIND_STYLE: Record<
  string,
  { badge: string; label: string }
> = {
  "entry:BUY": { badge: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/50", label: "ENTRY · BUY ▲" },
  "entry:SELL": { badge: "bg-red-500/15 text-red-400 ring-1 ring-red-500/50", label: "ENTRY · SELL ▼" },
  "exit:win": { badge: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/50", label: "EXIT · WIN ✓" },
  "exit:loss": { badge: "bg-red-500/15 text-red-300 ring-1 ring-red-500/50", label: "EXIT · LOSS ✗" },
  "exit:expired": { badge: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/50", label: "EXIT · EXPIRED" },
  "exit:superseded": { badge: "bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/50", label: "EXIT · REPLACED" },
  "note:NOTE": { badge: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/50", label: "BRAIN SELF-UPDATE" },
};

function kindStyle(m: AIMessage) {
  return KIND_STYLE[`${m.kind}:${m.outcome ?? m.signal}`] ?? KIND_STYLE["note:NOTE"];
}

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} ثانیه پیش`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} دقیقه پیش`;
  const hrs = Math.floor(min / 60);
  return `${hrs} ساعت و ${min % 60} دقیقه پیش`;
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}

/** live market report — the moment-to-moment Persian feed pushed by page.tsx */
function LiveSection({ symbolId }: { symbolId: string }) {
  const items = useLiveFeed(symbolId);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, 8);

  return (
    <div className="mb-3 rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-black tracking-wide text-sky-300">
          <Radio className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          گزارش زندهٔ بازار — لحظه‌به‌لحظه
        </span>
        <div className="flex items-center gap-1.5">
          {items.length > 8 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground hover:text-foreground"
            >
              {showAll ? "کمتر" : `همه (${items.length})`}
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={() => clearLive(symbolId)}
              aria-label="پاک‌کردن گزارش زنده"
              title="پاک‌کردن گزارش زنده"
              className="rounded-md p-1 text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          هنوز رویدادی ثبت نشده — با اولین BOS/CHoCH، شکست، فیک‌شکست یا تغییر پوزیشن، گزارش همین‌جا ظاهر می‌شود.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          {shown.map((it: LiveItem) => (
            <li key={it.id} className="rounded-lg border border-border bg-[#0d1117] px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-1.5 py-px text-[9px] font-black ${LIVE_KIND_CLS[it.kind]}`}>
                  {LIVE_KIND_FA[it.kind]}
                </span>
                {it.tf && (
                  <span className="rounded bg-secondary px-1.5 py-px font-mono text-[9px] font-bold text-muted-foreground">
                    {it.tf}
                  </span>
                )}
                <span dir="rtl" className="mr-auto font-mono text-[9px] text-muted-foreground">
                  {clock(it.t)} · {ago(it.t, Date.now())}
                </span>
              </div>
              <p dir="rtl" className="mt-1 text-[11.5px] font-bold leading-snug text-foreground/95">
                {it.text}
              </p>
              {it.sub && (
                <p dir="rtl" className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                  {it.sub}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AiMessages({ symbolId, digits }: Props) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [brain, setBrain] = useState<FeedResponse["brain"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const noteRef = useRef<string | null>(null);
  const panelFs = usePanelFs();

  const load = useCallback(async (sym: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch(`/api/ai/messages?symbol=${sym}&limit=12`, { cache: "no-store" });
      const j = (await res.json()) as FeedResponse;
      if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMessages(j.messages ?? []);
      setBrain(j.brain ?? null);
      if (j.note && j.note !== noteRef.current) {
        noteRef.current = j.note;
      }
    } catch {
      /* keep previous feed visible */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMessages([]);
    setOpenIds(new Set());
    void load(symbolId, true);
  }, [symbolId, load]);

  useEffect(() => {
    const id = setInterval(() => void load(symbolId), 60_000);
    return () => clearInterval(id);
  }, [symbolId, load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // newest entry message starts expanded so the reasoning is visible immediately
  useEffect(() => {
    const first = messages[0];
    if (first && messages.filter((m) => m.kind === "entry").length <= 1) {
      setOpenIds((prev) => {
        if (prev.has(first.id)) return prev;
        const next = new Set(prev);
        next.add(first.id);
        return next;
      });
    }
  }, [messages]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // older dev sessions left duplicate exit entries in the stored feed —
  // collapse repeats by content so the timeline reads clean
  const seenSig = new Set<string>();
  const deduped = messages.filter((m) => {
    const sig = `${m.kind}:${m.signal}:${m.outcome ?? ""}:${m.entry ?? ""}:${m.reasoning[0] ?? ""}`;
    if (seenSig.has(sig)) return false;
    seenSig.add(sig);
    return true;
  });

  return (
    <CollapsibleCard
      id="aimessages"
      fs={panelFs.fs}
      accentCls="border-emerald-500/30"
      defaultOpen
      title={
        <>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <MessageSquareText className="h-4 w-4 text-emerald-400" aria-hidden />
          </div>
          <h2 className="text-sm font-black tracking-wide">AI MESSAGES</h2>
          {messages.length > 0 && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">
              {messages.length}
            </span>
          )}
        </>
      }
      trailing={
        <>
          {brain && (
            <span className="font-mono text-[9px] text-muted-foreground" title="AI brain: self-learning journal">
              BRAIN v{brain.version}
              {brain.accuracy != null ? ` · ${brain.accuracy}% WR` : brain.open > 0 ? ` · ${brain.open} open` : ""}
            </span>
          )}
          <button
            onClick={() => void load(symbolId, true)}
            aria-label="Refresh AI messages"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          </button>
          <FsButton fs={panelFs.fs} onToggle={panelFs.toggle} label="AI MESSAGES" />
        </>
      }
    >

      <LiveSection symbolId={symbolId} />

      {messages.length === 0 && loading && (
        <div className="flex h-20 items-center justify-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> در حال خواندن پیام‌های هوش مصنوعی…
        </div>
      )}

      {messages.length === 0 && !loading && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          No AI messages yet. The moment SNIPER AI sees an entry or an exit, it will post it here —
          with its full reasoning chain and a drawn chart of the decision,
          <span dir="rtl" className="block pt-1 font-medium text-foreground/80">
            تا بتوانی استدلال و عملکردش را مطالعه کنی.
          </span>
        </p>
      )}

      <div className={`space-y-2.5 overflow-y-auto pr-0.5 [scrollbar-width:thin] ${panelFs.fs ? "h-[calc(100dvh-110px)]" : "max-h-[720px]"}`}>
        {deduped.map((msg, idx) => {
          const style = kindStyle(msg);
          const open = openIds.has(msg.id);
          return (
            <article
              key={msg.id}
              className="rounded-xl border border-border bg-[#0d1117] p-2.5"
            >
              {/* head */}
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-black tracking-wide ${style.badge}`}>
                    {style.label}
                  </span>
                  {msg.timeframe !== "—" && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">
                      {msg.timeframe.toUpperCase()}
                    </span>
                  )}
                  {msg.kind === "entry" && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] font-bold text-foreground/80">
                      CONF {msg.confidence}%
                    </span>
                  )}
                  {msg.pnlPct != null && (
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-black ${
                        msg.pnlPct >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"
                      }`}
                    >
                      {msg.pnlPct > 0 ? "+" : ""}
                      {msg.pnlPct.toFixed(2)}%
                    </span>
                  )}
                </div>
                <span dir="rtl" className="shrink-0 font-mono text-[9px] text-muted-foreground">
                  {ago(msg.t, now)}
                </span>
              </div>

              {/* the drawing */}
              {msg.chart && msg.chart.bars.length > 1 && (
                <div className="mb-2">
                  <SignalDiagram
                    chart={msg.chart}
                    signal={msg.signal === "NOTE" ? "WAIT" : msg.signal}
                    outcome={msg.outcome === "open" ? undefined : msg.outcome}
                    digits={digits}
                    height={200}
                  />
                </div>
              )}

              {/* levels */}
              {(msg.kind === "entry" || msg.kind === "exit") && msg.entry != null && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary/60 px-2.5 py-1.5 font-mono text-[11px] font-bold">
                  <span className="text-muted-foreground">
                    E <span className="text-foreground">{fmtPrice(msg.entry, digits)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    SL <span className="text-red-400">{fmtPrice(msg.stop, digits)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    TP1 <span className="text-emerald-400">{fmtPrice(msg.tp1, digits)}</span>
                  </span>
                  {msg.tp2 != null && (
                    <span className="text-muted-foreground">
                      TP2 <span className="text-amber-400">{fmtPrice(msg.tp2, digits)}</span>
                    </span>
                  )}
                  {msg.kind === "exit" && msg.outcome === "win" && msg.heldMs != null && (
                    <span dir="rtl" className="text-muted-foreground">
                      مدت{" "}
                      {msg.heldMs >= 5_400_000
                        ? `${Math.floor(msg.heldMs / 3_600_000)} ساعت و ${Math.round((msg.heldMs % 3_600_000) / 60_000)} دقیقه`
                        : `${Math.round(msg.heldMs / 60_000)} دقیقه`}
                    </span>
                  )}
                </div>
              )}

              {/* flow read */}
              {msg.flowRead && msg.kind !== "note" && (
                <p dir="auto" className="mb-1.5 border-l-2 border-emerald-500/50 pl-2 text-[11px] italic leading-snug text-muted-foreground">
                  {msg.flowRead}
                </p>
              )}

              {/* reasoning — the دلیـل */}
              {msg.reasoning.length > 0 && (
                <div>
                  <button
                    onClick={() => toggle(msg.id)}
                    className="flex w-full items-center justify-between rounded-md px-1 py-1 text-left hover:bg-secondary/40"
                    aria-expanded={open}
                  >
                    <span className="flex items-center gap-1 text-[10px] font-black tracking-widest text-emerald-400/90">
                      <Bot className="h-3 w-3" aria-hidden />
                      WHY — AI REASONING
                      <span dir="rtl" className="font-medium text-muted-foreground">
                        · چرایی تصمیم
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      aria-hidden
                    />
                  </button>
                  {open && (
                    <ol className="mt-1 space-y-1.5 px-1 pb-1">
                      {msg.reasoning.map((r, i) => (
                        <li key={i} className="flex gap-2 text-[11px] leading-snug text-foreground/90">
                          <span className="mt-px shrink-0 font-mono text-[9px] font-bold text-emerald-500/80">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span dir="auto">{r}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {/* invalidation */}
              {msg.invalidation && (
                <p dir="auto" className="mt-1.5 rounded-lg bg-red-500/5 px-2 py-1.5 text-[10px] leading-snug text-red-300/90">
                  <span className="font-bold">شرط ابطال: </span>
                  {msg.invalidation}
                </p>
              )}

              {/* footer: brain factors at decision time */}
              {msg.factors && idx === 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border pt-1.5">
                  <span className="text-[9px] font-bold tracking-wider text-muted-foreground">
                    BRAIN WEIGHTS
                  </span>
                  {(["flow", "structure", "mtf", "zone"] as const).map((k) => (
                    <span
                      key={k}
                      className={`rounded px-1 py-px font-mono text-[9px] ${
                        msg.factors![k] !== 1
                          ? msg.factors![k] > 1
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-amber-500/10 text-amber-400"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {k} ×{msg.factors![k].toFixed(2)}
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

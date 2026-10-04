import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Fail, Quiet } from "@/components/fail";
import type { DeskWalk } from "@/lib/envelope/backtest";
import { loadGraph, remember, type Hypothesis } from "@/lib/envelope/graph";
import type { BookId } from "@/lib/live/types";
import type { TfId } from "@/lib/live/tf";
import { cn } from "@/lib/utils";

const RAIL_TONE: Record<string, string> = {
  stack: "text-primary",
  fade: "text-warning",
  stretch: "text-muted-foreground",
};

function spark(eq: { t: number; v: number }[], cls: string) {
  if (eq.length < 2) return null;
  const max = Math.max(...eq.map((p) => p.v), 300);
  const min = Math.min(...eq.map((p) => p.v), 300);
  const span = max - min || 1;
  const d = eq
    .map((p, i) => {
      const x = (i / (eq.length - 1)) * 560;
      const y = 64 - ((p.v - min) / span) * 56 - 4;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 560 64" className={cn("mt-2 w-full", cls)} role="img" aria-label="equity">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function LoopPanel({ book, tf, embedded = false }: { book: BookId; tf: TfId; embedded?: boolean }) {
  const [data, setData] = useState<DeskWalk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [graph, setGraph] = useState<Hypothesis[]>([]);

  useEffect(() => setGraph(loadGraph()), []);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/live/backtest?book=${book}&tf=${tf}`);
      if (!res.ok) throw new Error(`walk ${res.status}`);
      const json = (await res.json()) as DeskWalk & { error?: string };
      if (json.error) throw new Error(json.error);
      setData(json);
      setErr(null);
      let nodes = loadGraph();
      for (const rail of json.rails ?? []) {
        for (const t of rail.bleed) {
          nodes = remember(nodes, {
            thesis: `${rail.rail} · ${t.thesis}`,
            result: "fail",
            pnl: t.pnl,
            source: "walk",
          });
        }
      }
      setGraph(nodes);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "walk failed");
    } finally {
      setBusy(false);
    }
  }, [book, tf]);

  return (
    <section className={cn("grid gap-4 px-4 sm:px-6 lg:grid-cols-12 lg:px-8", embedded ? "pb-8" : "py-4")}>
      <section className="rounded-sm border border-border bg-card p-4 shadow-sm lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Three rails</h2>
          <Badge>{book} · {tf}</Badge>
        </div>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Isolated $300 books. Clip is size. Daily stop −$150. Fill next bar. Costs first. DSR is P(skill | N=12), bar 0.95.
        </p>
        <Button className="mt-4" onClick={() => void run()} disabled={busy}>
          {busy ? "Walking…" : "Walk three rails"}
        </Button>
        {err ? <Fail message={err} /> : null}
        {!data && !err ? <Quiet message="Walk. Then read the DSR. If it is thin, sit." /> : null}
        {data ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Mini k="trials" v={`${data.nTrials}`} />
              <Mini
                k="DSR"
                v={data.dsr.prob == null ? "thin" : data.dsr.prob.toFixed(3)}
                down={data.dsr.prob != null && data.dsr.prob < 0.95}
              />
              <Mini k="worst fold" v={data.worstFold == null ? "—" : data.worstFold.toFixed(2)} down={(data.worstFold ?? 0) < 0} />
            </div>
            <p className="mt-2 font-mono text-xs text-subtle">{data.dsr.note}</p>
            {data.polyLive ? (
              <p className="mt-2 text-sm text-muted">
                Live Poly {data.polyLive.question}: YES {data.polyLive.yes.toFixed(2)} vs fair {data.polyLive.fair.toFixed(2)} · gap{" "}
                {(data.polyLive.gap * 100).toFixed(1)}pp
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No live Poly ladder on this pull.</p>
            )}
            <ul className="mt-4 space-y-4">
              {data.rails.map((r) => (
                <li key={r.rail} className="border-t border-border pt-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("font-mono text-xs uppercase tracking-widest", RAIL_TONE[r.rail ?? "stack"])}>
                      {r.rail}
                    </p>
                    <p className={cn("font-display text-xl italic tabular-nums", r.endCash >= 300 ? "text-armed" : "text-down")}>
                      ${r.endCash.toFixed(2)}
                    </p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-subtle">
                    {r.winN} up / {r.loseN} down · folds {r.folds?.map((f) => `${f.fold}:${f.pnl.toFixed(0)}`).join(" ")}
                  </p>
                  {spark(r.equity, RAIL_TONE[r.rail ?? "stack"] ?? "text-primary")}
                  <p className="mt-1 font-mono text-xs text-subtle">{r.note}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 max-w-prose text-sm text-muted">{data.note}</p>
          </>
        ) : null}
      </section>
      <aside className="lg:col-span-5">
        <section className="rounded-sm border border-border bg-card p-4 shadow-sm">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary">Hypothesis graph</h2>
          <p className="mt-2 max-w-prose text-sm text-muted">Losers stay. Three rails, one graveyard.</p>
          {graph.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Empty. Walk, or flatten a paper loser on Floor.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {graph.slice(0, 16).map((n) => (
                <li key={n.id} className="border-t border-border pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Badge tone={n.result === "fail" ? "down" : "armed"}>{n.result}</Badge>
                    <p className={cn("font-mono text-sm tabular-nums", n.pnl >= 0 ? "text-armed" : "text-down")}>
                      {n.pnl >= 0 ? "+" : ""}
                      {n.pnl.toFixed(2)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-muted">{n.thesis}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </section>
  );
}

function Mini({ k, v, down }: { k: string; v: string; down?: boolean }) {
  return (
    <div className="rounded-sm border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-widest text-subtle">{k}</p>
      <p className={cn("mt-1 font-mono text-sm tabular-nums", down ? "text-down" : "text-fg")}>{v}</p>
    </div>
  );
}

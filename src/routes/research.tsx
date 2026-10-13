import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getResearchDashboard, type Dashboard } from "@/lib/research/dashboard-fn";

export const Route = createFileRoute("/research")({ component: ResearchPage });

type Job = { id: string; stage: string; scenario: string; seed: number; rounds: number; catalyst: { name: string; when: string | null }; ids: Record<string, string>; extracted: Record<string, string | null> | null; error: string | null; cost: { estimatedUsd: number; actualUsd: number | null } };

function ResearchPage() {
  const [d, setD] = useState<Dashboard>(null);
  useEffect(() => {
    void getResearchDashboard().then((t) => setD(JSON.parse(t) as Dashboard));
  }, []);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Research (read-only)</p>
          <h1 className="font-display text-2xl italic">Scenarios vs calibrated probabilities</h1>
        </div>
        <Link to="/" className="flex h-11 items-center text-sm text-muted hover:text-fg">Back to desk</Link>
      </header>
      {!d ? <p className="p-6 text-sm text-muted">No dashboard yet (run `bun scripts/research-pipeline.ts dashboard`).</p> : (
        <div className="grid gap-6 p-4 sm:grid-cols-2 sm:p-6">
          <section className="rounded border border-border p-4" aria-label="simulated scenarios">
            <h2 className="mb-1 text-lg">Simulated scenarios</h2>
            <p className="mb-3 text-xs text-muted">{d.scenarios.label}</p>
            {(d.scenarios.jobs as Job[]).map((j) => (
              <article key={j.id} className="mb-3 border-t border-border pt-2 text-sm">
                <p className="font-mono text-xs">{j.id} · {j.stage} · {j.scenario} · seed {j.seed} · ≤{j.rounds} rounds</p>
                <p>{j.catalyst.name} {j.catalyst.when ? `(${j.catalyst.when})` : ""}</p>
                <p className="font-mono text-xs text-subtle">graph {j.ids.graphId || "–"} · sim {j.ids.simulationId || "–"} · report {j.ids.reportId || "–"} · est ${j.cost.estimatedUsd} · actual {j.cost.actualUsd == null ? "n/a" : `$${j.cost.actualUsd}`}</p>
                {j.error ? <p className="text-xs text-red-500">{j.error}</p> : null}
                {j.extracted ? <dl className="mt-1 text-xs">{Object.entries(j.extracted).filter(([k]) => k !== "complete").map(([k, v]) => <div key={k}><dt className="inline text-subtle">{k.replace(/_/g, " ")}: </dt><dd className="inline">{v ?? "unknown"}</dd></div>)}</dl> : null}
              </article>
            ))}
            <p className="text-xs text-subtle">Archive: {d.scenarios.archive.items} items · {d.scenarios.archive.matches} outcome matches · features approved for decisions: no</p>
          </section>
          <section className="rounded border border-border p-4" aria-label="calibrated probabilities">
            <h2 className="mb-1 text-lg">Calibrated probabilities</h2>
            <p className="mb-3 text-xs text-muted">{d.calibratedProbabilities.label}</p>
            <pre className="overflow-auto text-xs">{JSON.stringify({ milestone: d.calibratedProbabilities.milestone, calendar: d.calibratedProbabilities.calendar, collector: d.calibratedProbabilities.collector }, null, 1)}</pre>
          </section>
        </div>
      )}
      <p className="px-6 pb-6 text-xs text-subtle">Generated {d?.generatedAt ?? "–"}. Nothing on this page can place, cancel or approve an order.</p>
    </div>
  );
}

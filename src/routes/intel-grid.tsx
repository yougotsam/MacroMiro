import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getGridDashboard } from "@/lib/grid/dashboard-fn";

export const Route = createFileRoute("/intel-grid")({ component: GridPage });

type Row = Record<string, unknown>;
type Grid = { generatedAt: string; label: string; monitors: Row[]; pilot: Row | null; lastRefresh: string | null; materialChanges: Row[]; spark: Row[]; alexandria: { providers: Row[] | null; data: Row[] }; mirofish: Row[]; errors: Row[]; stale: Row[]; creditsByCategory: Record<string, number>; budget: Row; medianPublicationToDetectionMin: number | null; features: Row[]; featureEvaluation: string; modelPerformanceEffect: string } | null;

function List({ title, rows, keys }: { title: string; rows: Row[]; keys: string[] }) {
  return (
    <section className="rounded border border-border p-4" aria-label={title}>
      <h2 className="mb-2 text-lg">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted">None yet.</p> : rows.map((r, i) => (
        <p key={i} className="border-t border-border py-1 font-mono text-xs">{keys.map((k) => `${k}: ${typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k] ?? "–")}`).join(" · ")}</p>
      ))}
    </section>
  );
}

function GridPage() {
  const [d, setD] = useState<Grid>(null);
  useEffect(() => {
    void getGridDashboard().then((t) => setD(JSON.parse(t) as Grid));
  }, []);
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="flex items-end justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Intel Grid (research only)</p>
          <h1 className="font-display text-2xl italic">Monitors, evidence, Spark 2, Alexandria, MiroFish</h1>
        </div>
        <Link to="/" className="flex h-11 items-center text-sm text-muted hover:text-fg">Back to desk</Link>
      </header>
      {!d ? <p className="p-6 text-sm text-muted">No grid dashboard yet (run `bun scripts/grid/dashboard.ts`).</p> : (
        <div className="grid gap-6 p-4 sm:grid-cols-2 sm:p-6">
          <p className="text-xs text-muted sm:col-span-2">{d.label} Generated {d.generatedAt}. Last monitor refresh {d.lastRefresh ?? "–"}. Median publication→detection: {d.medianPublicationToDetectionMin ?? "n/a"} min.</p>
          <List title="Monitors" rows={d.monitors} keys={["key", "status", "cron", "estimatedCreditsPerMonth"]} />
          <List title="Credits by category (this round)" rows={Object.entries(d.creditsByCategory).map(([k, v]) => ({ category: k, credits: v }))} keys={["category", "credits"]} />
          <List title="Material changes" rows={d.materialChanges} keys={["title", "sourceUrl", "detectedAt", "summary"]} />
          <List title="Spark 2 research" rows={d.spark} keys={["title", "jobIds", "summary"]} />
          <List title="Alexandria providers" rows={d.alexandria.providers ?? []} keys={["provider", "status", "terms", "price"]} />
          <List title="MiroFish jobs (simulated)" rows={d.mirofish} keys={["title", "jobIds"]} />
          <List title="Errors" rows={d.errors} keys={["at", "path", "http", "note"]} />
          <List title="Stale / flagged" rows={d.stale} keys={["title", "stale", "injectionFlag"]} />
          <List title="Research features (weight 0)" rows={d.features} keys={["name", "status", "value", "evaluation"]} />
          <p className="text-xs text-muted sm:col-span-2">{d.featureEvaluation}. Model effect: {d.modelPerformanceEffect}.</p>
        </div>
      )}
    </div>
  );
}

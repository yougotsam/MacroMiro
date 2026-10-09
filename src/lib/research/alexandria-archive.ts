/**
 * Alexandria extension (Phase 4): an append-only archive of catalysts and MiroFish scenario runs, matched AFTER the
 * fact to official settlement-index moves, and measured for incremental value with a chronological train/eval split.
 * The existing `src/lib/live/alexandria.ts` (tool directory + desk-news reader) is untouched.
 *
 * Gate: MiroFish-derived features may only affect decisions after (1) proven out-of-sample value here AND (2) an owner
 * flag. The flag is false and nothing on the order path imports this module (research-isolation tests).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Job, ScenarioExtract } from "./pipeline";

export const MIROFISH_FEATURES_APPROVED = false as const;
export const HORIZONS_MIN = [15, 60, 240] as const;
export const ASSET_SERIES: Record<string, string> = { BTC: "KXBTC15M", ETH: "KXETH15M", SOL: "KXSOL15M", XRP: "KXXRP15M", GOLD: "KXGOLD15M" };

export type ArchiveItem = {
  id: string; kind: "simulation" | "event"; archivedAt: string;
  catalyst: { id: string; kind: string; name: string; when: string | null; sources: string[]; verified: boolean };
  scenario: string | null; seed: number | null; assets: string[]; regime: string;
  mirofish: { projectId: string; graphId: string; simulationId: string; reportId: string; rounds: number; actions: number } | null;
  extracted: ScenarioExtract | null; reportFile: string | null;
  sources: Array<{ url: string; title: string; fetchedAt: string }>;
  modelVersion: string; promptVersion: string | null;
  cost: { estimatedUsd: number | null; actualUsd: number | null };
  note: "simulated agents are not real order flow; scenario text is not a probability";
};

export class Archive {
  constructor(readonly dir: string) { mkdirSync(join(dir, "reports"), { recursive: true }); }
  get file() { return join(this.dir, "alexandria-archive.jsonl"); }
  all(): ArchiveItem[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as ArchiveItem]; } catch { return []; } });
  }
  /** idempotent by id (a resumed job never archives twice) */
  add(item: ArchiveItem) {
    if (this.all().some((x) => x.id === item.id)) return item.id;
    appendFileSync(this.file, JSON.stringify(item) + "\n");
    return item.id;
  }
  archiveJob(job: Job, markdown: string, extracted: ScenarioExtract, regime = "unknown") {
    const reportFile = join(this.dir, "reports", `${job.id}.md`);
    writeFileSync(reportFile, markdown);
    return this.add({
      id: job.id, kind: "simulation", archivedAt: new Date().toISOString(),
      catalyst: { ...job.spec.catalyst }, scenario: job.spec.scenario, seed: job.spec.seed, assets: job.spec.catalyst.assets, regime,
      mirofish: { projectId: job.ids.projectId, graphId: job.ids.graphId, simulationId: job.ids.simulationId, reportId: job.ids.reportId, rounds: job.progress.round, actions: job.progress.actions },
      extracted, reportFile, sources: job.seed.sources, modelVersion: job.modelVersion, promptVersion: job.spec.promptVersion,
      cost: { estimatedUsd: job.cost.estimatedUsd, actualUsd: job.cost.actualUsd }, note: "simulated agents are not real order flow; scenario text is not a probability",
    });
  }
}

export type IndexPoint = { ms: number; value: number };
export type Match = { id: string; asset: string; horizonMin: number; status: "matched" | "pending" | "no_data"; ret: number | null; dir: "up" | "down" | null; t0: string | null; catalystKind: string; regime: string; lean: string | null; eventMs: number };

function nearest(xs: IndexPoint[], ms: number, tol = 90_000) {
  let best: IndexPoint | null = null;
  for (const p of xs) if (Math.abs(p.ms - ms) <= tol && (!best || Math.abs(p.ms - ms) < Math.abs(best.ms - ms))) best = p;
  return best;
}

/** Outcome = official-index move from the event moment to +h. Missing data → pending/no_data, never filled in. */
export function matchOutcomes(items: ArchiveItem[], index: Map<string, IndexPoint[]>, now = Date.now()): Match[] {
  const out: Match[] = [];
  for (const it of items) {
    const t0 = it.catalyst.when && Number.isFinite(Date.parse(it.catalyst.when)) ? Date.parse(it.catalyst.when) : Date.parse(it.archivedAt);
    const lean = it.extracted?.lean?.match(/^(bullish|bearish|mixed|unclear)/i)?.[1]?.toLowerCase() ?? null;
    for (const a of it.assets) {
      const xs = index.get(ASSET_SERIES[a] ?? a) ?? [];
      for (const h of HORIZONS_MIN) {
        const base = { id: it.id, asset: a, horizonMin: h, catalystKind: it.catalyst.kind, regime: it.regime, lean, eventMs: t0 };
        if (t0 + h * 60_000 > now) { out.push({ ...base, status: "pending", ret: null, dir: null, t0: null }); continue; }
        const p0 = nearest(xs, t0), p1 = nearest(xs, t0 + h * 60_000);
        if (!p0 || !p1) { out.push({ ...base, status: "no_data", ret: null, dir: null, t0: null }); continue; }
        const ret = Math.log(p1.value / p0.value);
        out.push({ ...base, status: "matched", ret, dir: ret >= 0 ? "up" : "down", t0: new Date(p0.ms).toISOString() });
      }
    }
  }
  return out;
}

/**
 * Incremental value of the scenario lean over a naive base rate, chronological split (first 60 % of events = train,
 * rest = eval). Grouped by asset / catalyst / regime / horizon. Under 30 eval cases → "insufficient", no verdict.
 */
export function incrementalValue(matches: Match[], trainFrac = 0.6) {
  const usable = matches.filter((m) => m.status === "matched" && (m.lean === "bullish" || m.lean === "bearish"));
  const times = [...new Set(usable.map((m) => m.eventMs))].sort((a, b) => a - b);
  const cut = times[Math.floor(times.length * trainFrac)] ?? Infinity;
  const train = usable.filter((m) => m.eventMs < cut), evalSet = usable.filter((m) => m.eventMs >= cut);
  const group = (key: (m: Match) => string) => {
    const keys = new Set(usable.map(key));
    const res: Record<string, unknown> = {};
    for (const k of keys) {
      const tr = train.filter((m) => key(m) === k), ev = evalSet.filter((m) => key(m) === k);
      const upRate = tr.length ? tr.filter((m) => m.dir === "up").length / tr.length : 0.5;
      const baseDir = upRate >= 0.5 ? "up" : "down";
      const hit = ev.filter((m) => (m.lean === "bullish" ? "up" : "down") === m.dir).length;
      const baseHit = ev.filter((m) => m.dir === baseDir).length;
      res[k] = { train: tr.length, eval: ev.length, leanHitRate: ev.length ? hit / ev.length : null, baseRateHitRate: ev.length ? baseHit / ev.length : null, verdict: ev.length < 30 ? "insufficient (<30 eval cases)" : hit > baseHit ? "lean beat base rate (not yet significance-tested)" : "no incremental value" };
    }
    return res;
  };
  return {
    matched: matches.filter((m) => m.status === "matched").length, pending: matches.filter((m) => m.status === "pending").length, noData: matches.filter((m) => m.status === "no_data").length,
    withDirectionalLean: usable.length, train: train.length, eval: evalSet.length,
    byAsset: group((m) => m.asset), byCatalyst: group((m) => m.catalystKind), byRegime: group((m) => m.regime), byHorizon: group((m) => `${m.horizonMin}m`),
    featuresApprovedForDecisions: MIROFISH_FEATURES_APPROVED,
  };
}

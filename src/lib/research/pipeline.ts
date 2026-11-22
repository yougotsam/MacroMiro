/**
 * Event-driven research pipeline (Phases 2–3):
 *   Firecrawl (official/source pages) → Spark2 card (if fresh) → MiroFish graph → simulation → report → structured
 *   extraction → Alexandria archive → research dashboard.
 * Persistent jobs (one JSON file each + an append-only audit log), retries with backoff, status, cancel, duplicate-job
 * prevention, expiry/reuse across windows, and crash recovery (a restarted runner resumes from the saved ids and never
 * starts a simulation twice).
 *
 * RESEARCH ONLY. Nothing here can place, cancel or authorize an order, and nothing here produces a probability for the
 * desk: the simulation brief forbids probabilities, and extracted text is stored as labelled scenario context.
 * Simulated agents are not real order flow. An incomplete run has no result — nothing is invented.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicResearchWrite, researchLock } from "./storage";

export const SCENARIOS = ["baseline", "bullish", "bearish", "unexpected"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const CATALYST_KINDS = ["fomc", "cpi", "nfp", "ppi", "central_bank", "gold_macro", "crypto_regulation", "crypto_etf", "exchange_incident", "unusual_narrative"] as const;
export type CatalystKind = (typeof CATALYST_KINDS)[number];
export type Catalyst = { id: string; kind: CatalystKind; name: string; when: string | null; assets: string[]; sources: string[]; verified: boolean };
export type CostBasis = { modelVersion: string; priceVersion: string; source: string; agents: number; inPerM: number; outPerM: number };
export type JobSpec = { catalyst: Catalyst; scenario: Scenario; seed: number; maxRounds: number; budgetUsd: number; promptVersion: string; catalystBudgetUsd?: number; costBasis?: CostBasis };
export const ACTIVE_STAGES = ["queued", "seed", "ontology", "graph", "create", "prepare", "run", "report", "extract", "archive"] as const;
export type Stage = (typeof ACTIVE_STAGES)[number] | "done" | "failed" | "cancelled";
export const PROMPT_VERSION = "scenario-v2-provenance";
export const MAX_ROUNDS_CAP = 10;
export const MAX_SEED_CHARS = 6000;

export type Job = {
  id: string; key: string; spec: JobSpec; stage: Stage; createdAt: string; updatedAt: string; heartbeatAt: string | null;
  attempts: number; retries: number; totalRetries?: number; error: string | null; failedAt: Stage | null; cancelRequested: boolean;
  deadlineAt?: string;
  stopAttempts?: number;
  pendingReport?: { file: string; sha256: string; chars: number; extracted: ScenarioExtract; archivedAs?: string };
  ids: { projectId: string; graphTask: string; graphId: string; simulationId: string; prepTask: string; runStarted: boolean; reportId: string; reportTask: string };
  seed: {
    chars: number;
    sources: Array<{ url: string; title: string; fetchedAt: string; publishedAt?: string; publishedBasis?: string; docType?: string }>;
    /** documents fetched but refused by the provenance gate, with the reason */
    rejected?: Array<{ url: string; reason: string }>;
    spark: { event: string; at: string } | null; file: string | null;
  };
  progress: { round: number; totalRounds: number; actions: number; message: string; agents?: number | null };
  result: null | { reportChars: number; extracted: ScenarioExtract; archivedAs: string | null; completedAt: string };
  cost: { estimatedUsd: number; actualUsd: number | null; basis?: CostBasis; meterStatus?: "OK" | "UNAVAILABLE"; meterError?: string | null; meteredAt?: string; checkpoints?: Partial<Record<Stage, number>> };
  modelVersion: string; reuseUntil: string;
  history: Array<{ at: string; stage: Stage; note: string }>;
};

/** Fields pulled from the report's "Structured summary" block. Missing → null (never filled in). */
export const EXTRACT_FIELDS = ["sentiment_propagation", "contradictions", "crowding", "liquidity_hypotheses", "invalidation_conditions", "source_confidence", "disagreement", "lean"] as const;
export type ScenarioExtract = Record<(typeof EXTRACT_FIELDS)[number], string | null> & { complete: boolean };

export function jobKey(spec: Pick<JobSpec, "catalyst" | "scenario" | "seed" | "promptVersion">) {
  return createHash("sha256").update(`${spec.catalyst.id}|${spec.scenario}|${spec.seed}|${spec.promptVersion}`).digest("hex").slice(0, 16);
}

function reuseDeadline(event: string | null, createdMs: number) {
  const eventMs = Date.parse(event ?? "");
  return Number.isFinite(eventMs) ? eventMs > createdMs ? eventMs : eventMs + 24 * 3600_000 : createdMs + 24 * 3600_000;
}

/** Compute estimate (list price) — explicit, so a run can be refused before it spends. */
export function estimateCostUsd(spec: Pick<JobSpec, "maxRounds" | "costBasis">, p = { agents: 12, inTokPerAction: 3000, outTokPerAction: 400, fixedIn: 250_000, fixedOut: 40_000, inPerM: 0.75, outPerM: 3.75 }) {
  p = { ...p, ...spec.costBasis };
  const actions = p.agents * spec.maxRounds;
  const inTok = p.fixedIn + actions * p.inTokPerAction, outTok = p.fixedOut + actions * p.outTokPerAction;
  return Number(((inTok * p.inPerM + outTok * p.outPerM) / 1e6).toFixed(4));
}

export const SCENARIO_BRIEF: Record<Scenario, string> = {
  baseline: "BASELINE: the release/event lands broadly in line with what the sources say is expected.",
  bullish: "BULLISH SHOCK for risk assets and bitcoin (e.g. softer-than-expected inflation / dovish surprise).",
  bearish: "BEARISH SHOCK for risk assets and bitcoin (e.g. hotter-than-expected inflation / hawkish surprise).",
  unexpected: "UNEXPECTED REACTION: markets react against or out of proportion to the headline (e.g. a hot print but risk assets rally, an in-line print that triggers liquidations), or a side-story the sources do not anticipate.",
};

export function requirementFor(spec: JobSpec) {
  return [
    `Catalyst: ${spec.catalyst.name}${spec.catalyst.when ? ` (scheduled ${spec.catalyst.when})` : ""}. Assets: ${spec.catalyst.assets.join(", ")}.`,
    `Scenario to simulate: ${SCENARIO_BRIEF[spec.scenario]} Random seed label: ${spec.seed}.`,
    "Simulate how traders, analysts and observers discuss and react over the next hours. This is a narrative simulation, not market data.",
    "Do NOT state any probability, odds, percentage chance or price target anywhere in the report.",
    "End the report with a section titled exactly `## Structured summary` containing these lines, one each, `Key: value`:",
    ...EXTRACT_FIELDS.map((f) => `${f.replace(/_/g, " ")}: <one or two sentences${f === "lean" ? "; one of bullish, bearish, mixed, unclear" : f === "source_confidence" ? "; high, medium or low, and why" : ""}>`),
    "If the simulation does not support a field, write `unknown` for it.",
  ].join("\n");
}

/** Parse the structured block. Unknown/missing → null; complete only when every field is present. Probabilities are stripped. */
export function extractStructured(md: string): ScenarioExtract {
  // MiroFish's report agent writes the block as a heading or a bold line, sometimes once per section.
  // Parse every block; prefer the last complete one, else the last one with the most fields. Never merge blocks.
  const starts = [...md.matchAll(/^(?:#{1,6}\s*)*\**\s*Structured summary\s*\**\s*:?\s*$/gim)].map((m) => m.index ?? 0);
  const parsed = starts.map((i, k) => parseBlock(md.slice(i, starts[k + 1] ?? md.length)));
  const complete = parsed.filter((x) => x.complete);
  if (complete.length) return complete[complete.length - 1];
  return parsed.reduce<ScenarioExtract>((best, x) => (filled(x) >= filled(best) ? x : best), parseBlock(""));
}
const filled = (x: ScenarioExtract) => EXTRACT_FIELDS.filter((f) => x[f] != null).length;

function parseBlock(block: string): ScenarioExtract {
  const out = { ...Object.fromEntries(EXTRACT_FIELDS.map((f) => [f, null])), complete: false } as unknown as ScenarioExtract;
  for (const f of EXTRACT_FIELDS) {
    const re = new RegExp(`^[-*\\s]*\\**${f.replace(/_/g, "[ _]")}\\**\\s*[:：]\\s*(.+)$`, "im");
    const m = block.match(re);
    const v = m?.[1]?.replace(/[*`]/g, "").trim() ?? "";
    if (!v || /^unknown\.?$/i.test(v)) continue;
    // research text must not smuggle a number the desk could read as a probability
    // Raw reports retain the evidence. Extracted narratives deliberately carry no numeric claims.
    out[f] = v.replace(/\b(?:probability|odds|percentage chance)\b[^\n]*/gi, "[probability removed]")
      .replace(/[$€£¥]?\d[\d,]*(?:\.\d+)?\s*(?:%|percent\b|[kmb]\b)?/gi, "[number removed]").slice(0, 600);
  }
  if (out.lean && !/^(bullish|bearish|mixed|unclear)\b/i.test(out.lean)) out.lean = null;
  if (out.lean) out.lean = out.lean.toLowerCase();
  out.complete = EXTRACT_FIELDS.every((f) => out[f] != null);
  return out;
}

// ---------------------------------------------------------------------------------------------- store

export class JobStore {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, "jobs"), { recursive: true });
  }
  private path(id: string) { return join(this.dir, "jobs", `${id}.json`); }
  private cancelPath(id: string) { return join(this.dir, "jobs", `${id}.cancel`); }
  audit(job: Job, note: string) {
    appendFileSync(join(this.dir, "jobs-audit.jsonl"), JSON.stringify({ at: new Date().toISOString(), id: job.id, key: job.key, stage: job.stage, note }) + "\n");
  }
  save(job: Job, note?: string) {
    // A separate cancel process can race a worker's older JSON snapshot. Cancellation is monotonic.
    if (existsSync(this.cancelPath(job.id))) job.cancelRequested = true;
    job.updatedAt = new Date().toISOString();
    if (note) {
      job.history.push({ at: job.updatedAt, stage: job.stage, note: note.slice(0, 300) });
      this.audit(job, note);
    }
    atomicResearchWrite(this.path(job.id), JSON.stringify(job, null, 1));
  }
  get(id: string): Job | null {
    try {
      const job = JSON.parse(readFileSync(this.path(id), "utf8")) as Job;
      if (job?.id !== id || !job.spec || !job.cost || !job.stage) throw new Error("invalid job record");
      if (existsSync(this.cancelPath(id))) job.cancelRequested = true;
      return job;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      appendFileSync(join(this.dir, "jobs-audit.jsonl"), JSON.stringify({ at: new Date().toISOString(), id, note: "JOB_RECORD_UNREADABLE" }) + "\n");
      throw new Error(`research job ${id} is unreadable; inspect the saved record`);
    }
  }
  list(): Job[] {
    if (!existsSync(join(this.dir, "jobs"))) return [];
    return readdirSync(join(this.dir, "jobs")).filter((f) => f.endsWith(".json")).map((f) => this.get(f.slice(0, -5))).filter((j): j is Job => !!j).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Duplicate prevention: an active or still-reusable job with the same key is returned instead of a new one. */
  create(spec: JobSpec, now = Date.now(), modelVersion = "unknown"): { created: boolean; job: Job; reason: string } {
    const release = researchLock(join(this.dir, "admission.lock"));
    try { return this.createLocked(spec, now, modelVersion); } finally { release(); }
  }
  private createLocked(spec: JobSpec, now: number, modelVersion: string): { created: boolean; job: Job; reason: string } {
    if (!spec.catalyst?.id || !CATALYST_KINDS.includes(spec.catalyst.kind)) throw new Error("a job needs a catalyst (event-driven only)");
    if (/^KX[A-Z]+15M-/.test(spec.catalyst.id)) throw new Error("per-contract jobs are not allowed (event-driven only)");
    if (!SCENARIOS.includes(spec.scenario)) throw new Error(`unknown scenario ${spec.scenario}`);
    if (!(spec.maxRounds >= 1 && spec.maxRounds <= MAX_ROUNDS_CAP)) throw new Error(`maxRounds must be 1..${MAX_ROUNDS_CAP}`);
    if (!Number.isFinite(spec.budgetUsd) || spec.budgetUsd <= 0) throw new Error("job budget must be finite and positive");
    const cap = spec.catalystBudgetUsd ?? spec.budgetUsd;
    if (!Number.isFinite(cap) || cap <= 0) throw new Error("catalyst budget must be finite and positive");
    if (spec.costBasis && (spec.costBasis.modelVersion !== modelVersion || !spec.costBasis.priceVersion || !spec.costBasis.source || !Number.isInteger(spec.costBasis.agents) || spec.costBasis.agents < 1 || ![spec.costBasis.inPerM, spec.costBasis.outPerM].every(x => Number.isFinite(x) && x >= 0))) throw new Error("invalid or mismatched model cost basis");
    const key = jobKey(spec);
    const same = this.list().filter((j) => j.key === key);
    const live = same.find((j) => (ACTIVE_STAGES as readonly string[]).includes(j.stage));
    if (live) return { created: false, job: live, reason: `duplicate: job ${live.id} already ${live.stage}` };
    const reusable = same.find((j) => j.stage === "done" && j.modelVersion === modelVersion && j.spec.maxRounds === spec.maxRounds && j.cost.basis?.priceVersion === spec.costBasis?.priceVersion && Math.min(Date.parse(j.reuseUntil), reuseDeadline(j.spec.catalyst.when, Date.parse(j.createdAt))) > now);
    if (reusable) return { created: false, job: reusable, reason: `reuse: job ${reusable.id} report valid until ${reusable.reuseUntil}` };
    const est = estimateCostUsd(spec);
    if (est > spec.budgetUsd) throw new Error(`estimated $${est} exceeds the job budget $${spec.budgetUsd}`);
    const peers = this.list().filter(j => j.spec.catalyst.id === spec.catalyst.id);
    const effectiveCap = Math.min(cap, ...peers.map(j => j.spec.catalystBudgetUsd ?? j.spec.budgetUsd));
    const reserved = peers.reduce((sum, j) => sum + Math.max(j.cost.estimatedUsd, j.cost.actualUsd ?? 0), 0);
    if (reserved + est > effectiveCap) throw new Error(`catalyst budget exceeded: reserved $${reserved}, new $${est}, cap $${effectiveCap}`);
    const at = new Date(now).toISOString();
    const reuseUntil = new Date(reuseDeadline(spec.catalyst.when, now)).toISOString();
    const job: Job = {
      id: `rj-${now.toString(36)}-${key.slice(0, 6)}-${same.length + 1}`, key, spec, stage: "queued", createdAt: at, updatedAt: at, heartbeatAt: null,
      attempts: same.length + 1, retries: 0, error: null, failedAt: null, cancelRequested: false,
      ids: { projectId: "", graphTask: "", graphId: "", simulationId: "", prepTask: "", runStarted: false, reportId: "", reportTask: "" },
      seed: { chars: 0, sources: [], spark: null, file: null }, progress: { round: 0, totalRounds: 0, actions: 0, message: "" },
      result: null, cost: { estimatedUsd: est, actualUsd: null, basis: spec.costBasis }, modelVersion, reuseUntil, history: [],
    };
    this.save(job, `created (attempt ${job.attempts}; estimate $${est})`);
    return { created: true, job, reason: "created" };
  }

  cancel(id: string, reason: string) {
    const j = this.get(id);
    if (!j) return null;
    if (!(ACTIVE_STAGES as readonly string[]).includes(j.stage)) return j;
    atomicResearchWrite(this.cancelPath(id), "cancel requested\n");
    j.cancelRequested = true;
    this.save(j, `cancel requested: ${reason}`);
    return j;
  }
}

// ---------------------------------------------------------------------------------------------- MiroFish transport

export class TownError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean) { super(message); }
}
export type Transport = (path: string, init: { method: "GET" | "POST"; json?: unknown; form?: FormData; timeoutMs: number; signal?: AbortSignal }) => Promise<{ status: number; body: unknown }>;

/** Every MiroFish answer is {success, data, error}. Anything else is malformed → non-transient failure. */
export async function call(t: Transport, path: string, init: Parameters<Transport>[1]): Promise<Record<string, unknown>> {
  let r: { status: number; body: unknown };
  try {
    r = await t(path, init);
  } catch (e) {
    if (e instanceof TownError) throw e;
    throw new TownError(`${path} unreachable (${e instanceof Error ? e.message : String(e)})`, 0, true);
  }
  const b = r.body as { success?: unknown; data?: unknown; error?: unknown } | null;
  if (r.status === 401 || r.status === 503 && typeof b?.error === "string" && /auth/.test(b.error)) throw new TownError(`${path} auth refused (${r.status})`, r.status, false);
  if (!b || typeof b !== "object" || typeof b.success !== "boolean") throw new TownError(`${path} malformed response (http ${r.status})`, r.status, r.status >= 502);
  if (r.status >= 400 || b.success === false) throw new TownError(`${path} ${r.status}: ${typeof b.error === "string" ? b.error.slice(0, 300) : "error"}`, r.status, r.status === 409 || r.status === 429 || r.status >= 502);
  if (!b.data || typeof b.data !== "object") throw new TownError(`${path} malformed response (no data)`, r.status, false);
  return b.data as Record<string, unknown>;
}
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const need = (v: string, what: string, path: string) => { if (!v) throw new TownError(`${path} malformed response (no ${what})`, 200, false); return v; };

export type Seeder = (c: Catalyst, simStartMs?: number) => Promise<{ text: string; sources: Job["seed"]["sources"]; spark: Job["seed"]["spark"]; rejected?: Job["seed"]["rejected"] }>;
/** Must be idempotent by job.id, including a crash after committing but before returning its receipt. */
export type Archiver = (job: Job, reportMarkdown: string) => Promise<string | null>;
export type Deps = { transport: Transport; seeder: Seeder; archiver: Archiver; seedDir: string; pollMs?: number; meterSpentUsd?: (jobId: string) => number | null; checkBudget?: (job: Job) => void; modelVersion?: string };

/** The meter returns a cumulative ledger total. Never sum snapshots or replace a known cost with null. */
export function refreshJobCost(job: Job, d: Pick<Deps, "meterSpentUsd">, stage: Stage = job.stage) {
  try {
    const total = d.meterSpentUsd?.(job.id);
    if (total == null || !Number.isFinite(total) || total < 0) throw new Error("unavailable");
    if (job.cost.actualUsd != null && total < job.cost.actualUsd) throw new Error("regressed");
    job.cost.actualUsd = total;
    job.cost.meterStatus = "OK";
    job.cost.meterError = null;
    job.cost.meteredAt = new Date().toISOString();
    job.cost.checkpoints = { ...job.cost.checkpoints, [stage]: total };
  } catch {
    // A billing read is not allowed to destroy the report or leak upstream error payloads.
    job.cost.meterStatus = "UNAVAILABLE";
    job.cost.meterError = "COST_METER_UNAVAILABLE";
  }
}

export function checkResearchBudget(store: JobStore, job: Job) {
  if (!job.cost.basis || job.cost.basis.modelVersion !== job.modelVersion) throw new TownError("model-versioned cost basis required before paid work", 0, false);
  if (Math.max(job.cost.estimatedUsd, job.cost.actualUsd ?? 0) > job.spec.budgetUsd) throw new TownError("job compute budget exceeded", 0, false);
  const peers = store.list().filter(j => j.spec.catalyst.id === job.spec.catalyst.id && j.id !== job.id);
  const cap = Math.min(job.spec.catalystBudgetUsd ?? job.spec.budgetUsd, ...peers.map(j => j.spec.catalystBudgetUsd ?? j.spec.budgetUsd));
  const reserved = [job, ...peers].reduce((sum, j) => sum + Math.max(j.cost.estimatedUsd, j.cost.actualUsd ?? 0), 0);
  if (reserved > cap) throw new TownError("catalyst compute budget exceeded", 0, false);
}

async function preparedAgentCount(job: Job, d: Deps) {
  const sim = await call(d.transport, `/api/simulation/${encodeURIComponent(job.ids.simulationId)}`, { method: "GET", timeoutMs: 20_000 });
  const agents = num(sim.profiles_count);
  if (agents == null || !Number.isInteger(agents) || agents < 1) throw new TownError("prepared agent count unavailable; refusing simulation start", 0, false);
  job.progress.agents = agents;
  if (job.cost.basis) {
    job.cost.basis = { ...job.cost.basis, agents };
    job.cost.estimatedUsd = estimateCostUsd({ ...job.spec, costBasis: job.cost.basis });
    if (job.cost.estimatedUsd > job.spec.budgetUsd) throw new TownError("actual agent count exceeds job compute budget", 0, false);
    d.checkBudget?.(job);
  }
}

/** One step. Returns ms to wait before the next step. Mutates job; the runner saves it. */
export async function step(job: Job, d: Deps): Promise<number> {
  const poll = d.pollMs ?? 5000;
  const T = d.transport;
  switch (job.stage) {
    case "queued": job.stage = "seed"; return 0;
    case "seed": {
      const s = await d.seeder(job.spec.catalyst, Date.now());
      const text = s.text.slice(0, MAX_SEED_CHARS);
      if (!s.sources.length) { job.seed = { chars: 0, sources: [], rejected: s.rejected ?? [], spark: null, file: null }; throw new TownError("no source passed the provenance gate; nothing to simulate", 0, false); }
      if (text.trim().length < 200) throw new TownError("seed too short (sources gave < 200 chars); nothing to simulate", 0, false);
      mkdirSync(d.seedDir, { recursive: true });
      const file = join(d.seedDir, `${job.id}.md`);
      writeFileSync(file, text);
      job.seed = { chars: text.length, sources: s.sources, rejected: s.rejected ?? [], spark: s.spark, file };
      job.stage = "ontology";
      return 0;
    }
    case "ontology": {
      const form = new FormData();
      form.append("simulation_requirement", requirementFor(job.spec));
      form.append("project_name", `macromiro-${job.id}`);
      form.append("files", new Blob([readFileSync(job.seed.file!, "utf8")], { type: "text/markdown" }), "seed.md");
      const r = await call(T, "/api/graph/ontology/generate", { method: "POST", form, timeoutMs: 300_000 });
      job.ids.projectId = need(str(r.project_id), "project_id", "/api/graph/ontology/generate");
      job.stage = "graph";
      return 0;
    }
    case "graph": {
      if (!job.ids.graphTask) {
        const r = await call(T, "/api/graph/build", { method: "POST", json: { project_id: job.ids.projectId }, timeoutMs: 120_000 });
        job.ids.graphTask = need(str(r.task_id), "task_id", "/api/graph/build");
        job.ids.graphId = str(r.graph_id) || job.ids.graphId;
        return poll;
      }
      try {
        const r = await call(T, `/api/graph/task/${encodeURIComponent(job.ids.graphTask)}`, { method: "GET", timeoutMs: 20_000 });
        const st = str(r.status);
        job.progress.message = str(r.message) || job.progress.message;
        job.ids.graphId = str((r.result as Record<string, unknown> | undefined)?.graph_id) || job.ids.graphId;
        if (st === "failed") throw new TownError(`graph build failed: ${str(r.error).slice(0, 300)}`, 200, false);
        if (st !== "completed") return poll;
      } catch (e) {
        if (!(e instanceof TownError) || e.status !== 404) throw e;
        // tasks live in MiroFish memory; after a backend restart the project record is the truth
        const p = await call(T, `/api/graph/project/${encodeURIComponent(job.ids.projectId)}`, { method: "GET", timeoutMs: 20_000 });
        job.ids.graphId = str(p.graph_id) || job.ids.graphId;
        if (str(p.status) === "failed") throw new TownError("graph build failed (project status)", 200, false);
        if (str(p.status) !== "graph_completed") return poll;
      }
      need(job.ids.graphId, "graph_id", "graph");
      job.stage = "create";
      return 0;
    }
    case "create": {
      const r = await call(T, "/api/simulation/create", { method: "POST", json: { project_id: job.ids.projectId, graph_id: job.ids.graphId, enable_twitter: true, enable_reddit: false }, timeoutMs: 60_000 });
      job.ids.simulationId = need(str(r.simulation_id), "simulation_id", "/api/simulation/create");
      job.stage = "prepare";
      return 0;
    }
    case "prepare": {
      if (!job.ids.prepTask) {
        const r = await call(T, "/api/simulation/prepare", { method: "POST", json: { simulation_id: job.ids.simulationId, parallel_profile_count: 3 }, timeoutMs: 240_000 });
        if (r.already_prepared === true) { await preparedAgentCount(job, d); job.stage = "run"; return 0; }
        job.ids.prepTask = need(str(r.task_id), "task_id", "/api/simulation/prepare");
        return poll;
      }
      const r = await call(T, "/api/simulation/prepare/status", { method: "POST", json: { task_id: job.ids.prepTask, simulation_id: job.ids.simulationId }, timeoutMs: 30_000 });
      const st = str(r.status);
      job.progress.message = str(r.message) || job.progress.message;
      if (st === "failed") throw new TownError(`prepare failed: ${str(r.error).slice(0, 300)}`, 200, false);
      if (st === "ready" || st === "completed" || r.already_prepared === true) {
        // real agent count, as MiroFish reports it (null if not reported; never guessed)
        await preparedAgentCount(job, d);
        job.stage = "run";
        return 0;
      }
      return poll;
    }
    case "run": {
      const path = `/api/simulation/${encodeURIComponent(job.ids.simulationId)}/run-status`;
      if (!job.ids.runStarted) {
        // recovery: a start that timed out on our side may have started over there — look first, start at most once
        const seen = await call(T, path, { method: "GET", timeoutMs: 20_000 });
        const already = str(seen.runner_status);
        if (["starting", "running", "paused", "stopping", "stopped", "completed", "failed"].includes(already)) { job.ids.runStarted = true; return 0; }
        if (already !== "idle") throw new TownError("simulation start state unknown; refusing duplicate start", 0, false);
        await preparedAgentCount(job, d);
        await call(T, "/api/simulation/start", { method: "POST", json: { simulation_id: job.ids.simulationId, platform: "twitter", max_rounds: Math.min(job.spec.maxRounds, MAX_ROUNDS_CAP) }, timeoutMs: 120_000 });
        job.ids.runStarted = true;
        return poll;
      }
      const r = await call(T, path, { method: "GET", timeoutMs: 20_000 });
      const st = str(r.runner_status);
      job.progress.round = num(r.current_round) ?? job.progress.round;
      job.progress.totalRounds = num(r.total_rounds) ?? job.progress.totalRounds;
      job.progress.actions = num(r.total_actions_count) ?? job.progress.actions;
      job.progress.message = `round ${job.progress.round}/${job.progress.totalRounds || job.spec.maxRounds} · ${job.progress.actions} simulated actions · ${st}`;
      if (st === "failed") throw new TownError(`simulation failed: ${str(r.error).slice(0, 300)}`, 200, false);
      if (st === "completed" || st === "stopped") { job.stage = "report"; return 0; }
      if (st === "running") {
        const env = await call(T, "/api/simulation/env-status", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 15_000 }).catch(() => null);
        if (env?.env_alive === true) {
          // Backend sets env_alive only in its POST-ROUND interview-wait phase. False is normal during rounds.
          job.progress.message = "simulation rounds finished; stopping interview environment";
          if ((job.stopAttempts ?? 0) >= MAX_STOP_ATTEMPTS) throw new TownError("simulation shutdown unconfirmed after bounded stop attempts", 0, false);
          job.stopAttempts = (job.stopAttempts ?? 0) + 1;
          await call(T, "/api/simulation/stop", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 15_000 });
          return 1000;
        }
      }
      return poll;
    }
    case "report": {
      if (!job.ids.reportId) {
        const r = await call(T, "/api/report/generate", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 60_000 });
        job.ids.reportId = need(str(r.report_id), "report_id", "/api/report/generate");
        job.ids.reportTask = r.already_generated === true ? "" : str(r.task_id);
        return job.ids.reportTask ? poll : 0;
      }
      if (job.ids.reportTask) {
        const r = await call(T, "/api/report/generate/status", { method: "POST", json: { task_id: job.ids.reportTask, simulation_id: job.ids.simulationId }, timeoutMs: 30_000 });
        const st = str(r.status);
        job.progress.message = str(r.message) || job.progress.message;
        if (st === "failed") throw new TownError(`report failed: ${str(r.error).slice(0, 300)}`, 200, false);
        if (st !== "completed") return poll;
        job.ids.reportTask = "";
      }
      job.stage = "extract";
      return 0;
    }
    case "extract": {
      const r = await call(T, `/api/report/${encodeURIComponent(job.ids.reportId)}`, { method: "GET", timeoutMs: 30_000 });
      const md = str(r.markdown_content);
      if (!md.trim() || str(r.status) && str(r.status) !== "completed") throw new TownError("report incomplete (no markdown / not completed); nothing archived", 200, false);
      const extracted = extractStructured(md);
      const file = join(d.seedDir, `${job.id}.report.md`);
      mkdirSync(d.seedDir, { recursive: true });
      atomicResearchWrite(file, md);
      job.pendingReport = { file, sha256: createHash("sha256").update(md).digest("hex"), chars: md.length, extracted };
      job.stage = "archive";
      return 0;
    }
    case "archive": {
      const pending = job.pendingReport;
      // Recover old saved archive-stage jobs through the completed-report fetch, never invent a report.
      if (!pending) { job.stage = "extract"; return 0; }
      const md = readFileSync(pending.file, "utf8");
      if (createHash("sha256").update(md).digest("hex") !== pending.sha256) throw new TownError("staged report checksum mismatch", 0, false);
      if (!pending.archivedAs) {
        const receiptFile = `${pending.file}.receipt.json`;
        if (existsSync(receiptFile)) {
          const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
          if (receipt.jobId !== job.id || receipt.sha256 !== pending.sha256 || typeof receipt.archivedAs !== "string" || !receipt.archivedAs) throw new TownError("archive receipt mismatch", 0, false);
          pending.archivedAs = receipt.archivedAs;
        } else {
          const archivedAs = await d.archiver(job, md);
          if (!archivedAs) throw new TownError("archive receipt missing", 0, true);
          atomicResearchWrite(receiptFile, JSON.stringify({ jobId: job.id, sha256: pending.sha256, archivedAs }));
          pending.archivedAs = archivedAs;
        }
        return 0; // Save the receipt in the archive stage before declaring done.
      }
      job.result = { reportChars: pending.chars, extracted: pending.extracted, archivedAs: pending.archivedAs, completedAt: new Date().toISOString() };
      job.stage = "done";
      return 0;
    }
    default:
      return 0;
  }
}

export const MAX_RETRIES = 6;
export const MAX_STOP_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drive one job to a terminal stage. One worker per store, with a durable deadline across restarts. */
export async function drive(store: JobStore, id: string, d: Deps, opts: { maxMinutes?: number; sleepFn?: (ms: number) => Promise<void>; cancelPollMs?: number } = {}) {
  const release = researchLock(join(store.dir, "worker.lock"));
  try { return await driveLocked(store, id, d, opts); } finally { release(); }
}

async function driveLocked(store: JobStore, id: string, d: Deps, opts: { maxMinutes?: number; sleepFn?: (ms: number) => Promise<void>; cancelPollMs?: number }) {
  const sl = opts.sleepFn ?? sleep;
  const minutes = opts.maxMinutes ?? 90;
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("maxMinutes must be finite and positive");
  const stop = async (job: Job) => {
    if (job.ids.simulationId && job.ids.runStarted) {
      if ((job.stopAttempts ?? 0) >= MAX_STOP_ATTEMPTS) { job.progress.message = "simulation stop unconfirmed; inspect backend"; return; }
      job.stopAttempts = (job.stopAttempts ?? 0) + 1;
      await call(d.transport, "/api/simulation/stop", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 5000 }).catch(() => {
        job.progress.message = "simulation stop unconfirmed; inspect backend before another paid run";
      });
    }
  };
  for (;;) {
    const job = store.get(id);
    if (!job) throw new Error(`research job ${id} not found`);
    refreshJobCost(job, d);
    if (!(ACTIVE_STAGES as readonly string[]).includes(job.stage)) {
      if (job.stage === "done" && job.cancelRequested) { job.stage = "cancelled"; job.result = null; }
      store.save(job);
      return job;
    }
    if (!job.deadlineAt) {
      job.deadlineAt = new Date(Date.now() + minutes * 60_000).toISOString();
      store.save(job, "execution deadline set");
    }
    const deadline = Date.parse(job.deadlineAt);
    const finishingReport = job.stage === "archive" && !!job.pendingReport;
    if (job.cancelRequested || ((!Number.isFinite(deadline) || Date.now() >= deadline) && !finishingReport)) {
      await stop(job);
      refreshJobCost(job, d);
      job.failedAt = job.stage;
      job.stage = job.cancelRequested ? "cancelled" : "failed";
      job.error = job.cancelRequested ? null : "timed out; incomplete run has no result";
      job.result = null;
      store.save(job, job.error ?? "cancelled; no result recorded");
      return job;
    }
    const before = job.stage;
    let wait = 0;
    const controller = new AbortController();
    const timer = setInterval(() => {
      try {
        if (store.get(id)?.cancelRequested || (!finishingReport && Date.now() >= deadline)) controller.abort();
      } catch { controller.abort(); }
    }, opts.cancelPollMs ?? 250);
    try {
      const deps: Deps = { ...d, checkBudget: j => checkResearchBudget(store, j), transport: (path, init) => {
        // Budget gates block new paid work, never retrieval/archiving of an already-paid report.
        if (init.method === "POST" && ["/api/graph/ontology/generate", "/api/graph/build", "/api/simulation/create", "/api/simulation/prepare", "/api/simulation/start", "/api/report/generate"].includes(path)) {
          if (d.modelVersion && d.modelVersion !== job.modelVersion) throw new TownError("configured model changed; reconcile the job cost basis before paid work", 0, false);
          checkResearchBudget(store, job);
        }
        return d.transport(path, { ...init, signal: controller.signal, timeoutMs: Math.max(1, Math.min(init.timeoutMs, deadline - Date.now())) });
      } };
      wait = await step(job, deps);
      job.retries = 0; // Consecutive failed steps, not the lifetime count.
      job.error = null;
    } catch (e) {
      const transient = e instanceof TownError ? e.transient : true;
      const msg = e instanceof Error ? e.message : String(e);
      job.retries += 1;
      job.totalRetries = (job.totalRetries ?? 0) + 1;
      if (transient && job.retries <= MAX_RETRIES) {
        job.error = `retry ${job.retries}/${MAX_RETRIES}: ${msg}`;
        wait = Math.min(60_000, (d.pollMs ?? 5000) * 2 ** (job.retries - 1));
      } else {
        job.failedAt = job.stage;
        job.stage = "failed";
        job.error = msg;
        job.result = null;
        await stop(job);
      }
    } finally {
      clearInterval(timer);
      refreshJobCost(job, d, before); // Includes failed/cancelled expensive calls; never throws.
    }
    job.heartbeatAt = new Date().toISOString();
    if (store.get(id)?.cancelRequested) {
      job.cancelRequested = true;
      await stop(job);
      refreshJobCost(job, d, before);
      job.failedAt = before;
      job.stage = "cancelled";
      job.result = null;
      wait = 0;
    }
    store.save(job, job.stage !== before ? `${before} → ${job.stage}${job.error ? ` (${job.error})` : ""}` : job.error ?? undefined);
    // Poll cancellation during retry backoff as well as during in-flight HTTP.
    while (wait > 0) {
      const chunk = Math.min(wait, 250);
      await sl(chunk);
      wait -= chunk;
      if (store.get(id)?.cancelRequested) break;
    }
  }
}

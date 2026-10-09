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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCENARIOS = ["baseline", "bullish", "bearish", "unexpected"] as const;
export type Scenario = (typeof SCENARIOS)[number];
export const CATALYST_KINDS = ["fomc", "cpi", "nfp", "ppi", "central_bank", "gold_macro", "crypto_regulation", "crypto_etf", "exchange_incident", "unusual_narrative"] as const;
export type CatalystKind = (typeof CATALYST_KINDS)[number];
export type Catalyst = { id: string; kind: CatalystKind; name: string; when: string | null; assets: string[]; sources: string[]; verified: boolean };
export type JobSpec = { catalyst: Catalyst; scenario: Scenario; seed: number; maxRounds: number; budgetUsd: number; promptVersion: string };
export const ACTIVE_STAGES = ["queued", "seed", "ontology", "graph", "create", "prepare", "run", "report", "extract", "archive"] as const;
export type Stage = (typeof ACTIVE_STAGES)[number] | "done" | "failed" | "cancelled";
export const PROMPT_VERSION = "scenario-v1";
export const MAX_ROUNDS_CAP = 10;
export const MAX_SEED_CHARS = 6000;

export type Job = {
  id: string; key: string; spec: JobSpec; stage: Stage; createdAt: string; updatedAt: string; heartbeatAt: string | null;
  attempts: number; retries: number; error: string | null; failedAt: Stage | null; cancelRequested: boolean;
  ids: { projectId: string; graphTask: string; graphId: string; simulationId: string; prepTask: string; runStarted: boolean; reportId: string; reportTask: string };
  seed: { chars: number; sources: Array<{ url: string; title: string; fetchedAt: string }>; spark: { event: string; at: string } | null; file: string | null };
  progress: { round: number; totalRounds: number; actions: number; message: string };
  result: null | { reportChars: number; extracted: ScenarioExtract; archivedAs: string | null; completedAt: string };
  cost: { estimatedUsd: number; actualUsd: number | null };
  modelVersion: string; reuseUntil: string;
  history: Array<{ at: string; stage: Stage; note: string }>;
};

/** Fields pulled from the report's "Structured summary" block. Missing → null (never filled in). */
export const EXTRACT_FIELDS = ["sentiment_propagation", "contradictions", "crowding", "liquidity_hypotheses", "invalidation_conditions", "source_confidence", "disagreement", "lean"] as const;
export type ScenarioExtract = Record<(typeof EXTRACT_FIELDS)[number], string | null> & { complete: boolean };

export function jobKey(spec: Pick<JobSpec, "catalyst" | "scenario" | "seed" | "promptVersion">) {
  return createHash("sha256").update(`${spec.catalyst.id}|${spec.scenario}|${spec.seed}|${spec.promptVersion}`).digest("hex").slice(0, 16);
}

/** Compute estimate (list price) — explicit, so a run can be refused before it spends. */
export function estimateCostUsd(spec: Pick<JobSpec, "maxRounds">, p = { agents: 12, inTokPerAction: 3000, outTokPerAction: 400, fixedIn: 250_000, fixedOut: 40_000, inPerM: 0.75, outPerM: 3.75 }) {
  const actions = p.agents * spec.maxRounds;
  const inTok = p.fixedIn + actions * p.inTokPerAction, outTok = p.fixedOut + actions * p.outTokPerAction;
  return Number(((inTok * p.inPerM + outTok * p.outPerM) / 1e6).toFixed(4));
}

const SCENARIO_BRIEF: Record<Scenario, string> = {
  baseline: "BASELINE: the release/event lands broadly in line with what the sources say is expected.",
  bullish: "BULLISH SHOCK for risk assets and bitcoin (e.g. softer-than-expected inflation / dovish surprise).",
  bearish: "BEARISH SHOCK for risk assets and bitcoin (e.g. hotter-than-expected inflation / hawkish surprise).",
  unexpected: "UNEXPECTED: an outcome or side-story the sources do not anticipate (data delay, revision, policy surprise, exchange incident).",
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
    out[f] = v.replace(/\b\d{1,3}(?:\.\d+)?\s*(%|percent)/gi, "[number removed]").replace(/\bprobability\b[^.]*\./gi, "[probability removed].").slice(0, 600);
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
  audit(job: Job, note: string) {
    appendFileSync(join(this.dir, "jobs-audit.jsonl"), JSON.stringify({ at: new Date().toISOString(), id: job.id, key: job.key, stage: job.stage, note }) + "\n");
  }
  save(job: Job, note?: string) {
    job.updatedAt = new Date().toISOString();
    if (note) {
      job.history.push({ at: job.updatedAt, stage: job.stage, note: note.slice(0, 300) });
      this.audit(job, note);
    }
    const p = this.path(job.id);
    writeFileSync(`${p}.tmp`, JSON.stringify(job, null, 1));
    renameSync(`${p}.tmp`, p);
  }
  get(id: string): Job | null {
    try { return JSON.parse(readFileSync(this.path(id), "utf8")) as Job; } catch { return null; }
  }
  list(): Job[] {
    if (!existsSync(join(this.dir, "jobs"))) return [];
    return readdirSync(join(this.dir, "jobs")).filter((f) => f.endsWith(".json")).map((f) => this.get(f.slice(0, -5))).filter((j): j is Job => !!j).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Duplicate prevention: an active or still-reusable job with the same key is returned instead of a new one. */
  create(spec: JobSpec, now = Date.now(), modelVersion = "unknown"): { created: boolean; job: Job; reason: string } {
    if (!spec.catalyst?.id || !CATALYST_KINDS.includes(spec.catalyst.kind)) throw new Error("a job needs a catalyst (event-driven only)");
    if (/^KX[A-Z]+15M-/.test(spec.catalyst.id)) throw new Error("per-contract jobs are not allowed (event-driven only)");
    if (!SCENARIOS.includes(spec.scenario)) throw new Error(`unknown scenario ${spec.scenario}`);
    if (!(spec.maxRounds >= 1 && spec.maxRounds <= MAX_ROUNDS_CAP)) throw new Error(`maxRounds must be 1..${MAX_ROUNDS_CAP}`);
    const key = jobKey(spec);
    const same = this.list().filter((j) => j.key === key);
    const live = same.find((j) => (ACTIVE_STAGES as readonly string[]).includes(j.stage));
    if (live) return { created: false, job: live, reason: `duplicate: job ${live.id} already ${live.stage}` };
    const reusable = same.find((j) => j.stage === "done" && Date.parse(j.reuseUntil) > now);
    if (reusable) return { created: false, job: reusable, reason: `reuse: job ${reusable.id} report valid until ${reusable.reuseUntil}` };
    const est = estimateCostUsd(spec);
    if (est > spec.budgetUsd) throw new Error(`estimated $${est} exceeds the job budget $${spec.budgetUsd}`);
    const at = new Date(now).toISOString();
    const eventMs = spec.catalyst.when ? Date.parse(spec.catalyst.when) : NaN;
    const reuseUntil = new Date((Number.isFinite(eventMs) ? Math.max(eventMs, now) : now) + 24 * 3600_000).toISOString();
    const job: Job = {
      id: `rj-${now.toString(36)}-${key.slice(0, 6)}`, key, spec, stage: "queued", createdAt: at, updatedAt: at, heartbeatAt: null,
      attempts: same.length + 1, retries: 0, error: null, failedAt: null, cancelRequested: false,
      ids: { projectId: "", graphTask: "", graphId: "", simulationId: "", prepTask: "", runStarted: false, reportId: "", reportTask: "" },
      seed: { chars: 0, sources: [], spark: null, file: null }, progress: { round: 0, totalRounds: 0, actions: 0, message: "" },
      result: null, cost: { estimatedUsd: est, actualUsd: null }, modelVersion, reuseUntil, history: [],
    };
    this.save(job, `created (attempt ${job.attempts}; estimate $${est})`);
    return { created: true, job, reason: "created" };
  }

  cancel(id: string, reason: string) {
    const j = this.get(id);
    if (!j) return null;
    if (!(ACTIVE_STAGES as readonly string[]).includes(j.stage)) return j;
    j.cancelRequested = true;
    this.save(j, `cancel requested: ${reason}`);
    return j;
  }
}

// ---------------------------------------------------------------------------------------------- MiroFish transport

export class TownError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean) { super(message); }
}
export type Transport = (path: string, init: { method: "GET" | "POST"; json?: unknown; form?: FormData; timeoutMs: number }) => Promise<{ status: number; body: unknown }>;

/** Every MiroFish answer is {success, data, error}. Anything else is malformed → non-transient failure. */
export async function call(t: Transport, path: string, init: Parameters<Transport>[1]): Promise<Record<string, unknown>> {
  let r: { status: number; body: unknown };
  try {
    r = await t(path, init);
  } catch (e) {
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

export type Seeder = (c: Catalyst) => Promise<{ text: string; sources: Job["seed"]["sources"]; spark: Job["seed"]["spark"] }>;
export type Archiver = (job: Job, reportMarkdown: string) => Promise<string | null>;
export type Deps = { transport: Transport; seeder: Seeder; archiver: Archiver; seedDir: string; pollMs?: number; meterSpentUsd?: (jobId: string) => number | null };

/** One step. Returns ms to wait before the next step. Mutates job; the runner saves it. */
export async function step(job: Job, d: Deps): Promise<number> {
  const poll = d.pollMs ?? 5000;
  const T = d.transport;
  switch (job.stage) {
    case "queued": job.stage = "seed"; return 0;
    case "seed": {
      const s = await d.seeder(job.spec.catalyst);
      const text = s.text.slice(0, MAX_SEED_CHARS);
      if (text.trim().length < 200) throw new TownError("seed too short (sources gave < 200 chars); nothing to simulate", 0, false);
      mkdirSync(d.seedDir, { recursive: true });
      const file = join(d.seedDir, `${job.id}.md`);
      writeFileSync(file, text);
      job.seed = { chars: text.length, sources: s.sources, spark: s.spark, file };
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
        if (r.already_prepared === true) { job.stage = "run"; return 0; }
        job.ids.prepTask = need(str(r.task_id), "task_id", "/api/simulation/prepare");
        return poll;
      }
      const r = await call(T, "/api/simulation/prepare/status", { method: "POST", json: { task_id: job.ids.prepTask, simulation_id: job.ids.simulationId }, timeoutMs: 30_000 });
      const st = str(r.status);
      job.progress.message = str(r.message) || job.progress.message;
      if (st === "failed") throw new TownError(`prepare failed: ${str(r.error).slice(0, 300)}`, 200, false);
      if (st === "ready" || st === "completed" || r.already_prepared === true) { job.stage = "run"; return 0; }
      return poll;
    }
    case "run": {
      const path = `/api/simulation/${encodeURIComponent(job.ids.simulationId)}/run-status`;
      if (!job.ids.runStarted) {
        // recovery: a start that timed out on our side may have started over there — look first, start at most once
        const seen = await call(T, path, { method: "GET", timeoutMs: 20_000 }).catch(() => null);
        const already = seen ? str(seen.runner_status) : "";
        if (already && already !== "idle") { job.ids.runStarted = true; return 0; }
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
          await call(T, "/api/simulation/stop", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 120_000 });
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
    case "extract":
    case "archive": {
      const r = await call(T, `/api/report/${encodeURIComponent(job.ids.reportId)}`, { method: "GET", timeoutMs: 30_000 });
      const md = str(r.markdown_content);
      if (!md.trim() || str(r.status) && str(r.status) !== "completed") throw new TownError("report incomplete (no markdown / not completed); nothing archived", 200, false);
      const extracted = extractStructured(md);
      job.stage = "archive";
      job.cost.actualUsd = d.meterSpentUsd?.(job.id) ?? null;
      const archivedAs = await d.archiver(job, md);
      job.result = { reportChars: md.length, extracted, archivedAs, completedAt: new Date().toISOString() };
      job.cost.actualUsd = d.meterSpentUsd?.(job.id) ?? null;
      job.stage = "done";
      return 0;
    }
    default:
      return 0;
  }
}

export const MAX_RETRIES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Drive one job to a terminal stage (resumable; saves after every step). */
export async function drive(store: JobStore, id: string, d: Deps, opts: { maxMinutes?: number; sleepFn?: (ms: number) => Promise<void> } = {}) {
  const sl = opts.sleepFn ?? sleep;
  const deadline = Date.now() + (opts.maxMinutes ?? 90) * 60_000;
  for (;;) {
    const job = store.get(id);
    if (!job || !(ACTIVE_STAGES as readonly string[]).includes(job.stage)) return job;
    if (job.cancelRequested) {
      if (job.ids.simulationId && job.ids.runStarted) await call(d.transport, "/api/simulation/stop", { method: "POST", json: { simulation_id: job.ids.simulationId }, timeoutMs: 60_000 }).catch(() => null);
      job.failedAt = job.stage;
      job.stage = "cancelled";
      store.save(job, "cancelled; no result recorded");
      return job;
    }
    if (Date.now() > deadline) {
      job.failedAt = job.stage;
      job.stage = "failed";
      job.error = "timed out; incomplete run has no result";
      store.save(job, job.error);
      return job;
    }
    const before = job.stage;
    let wait = 0;
    try {
      wait = await step(job, d);
      job.retries = 0;
      job.error = null;
    } catch (e) {
      const transient = e instanceof TownError ? e.transient : true;
      const msg = e instanceof Error ? e.message : String(e);
      job.retries += 1;
      if (transient && job.retries <= MAX_RETRIES) {
        job.error = `retry ${job.retries}/${MAX_RETRIES}: ${msg}`;
        wait = Math.min(60_000, (d.pollMs ?? 5000) * 2 ** (job.retries - 1));
      } else {
        job.failedAt = job.stage;
        job.stage = "failed";
        job.error = msg;
        job.result = null; // never a partial/invented result
      }
    }
    job.heartbeatAt = new Date().toISOString();
    // never overwrite a cancel that arrived while this step ran
    const latest = store.get(id);
    if (latest?.cancelRequested) job.cancelRequested = true;
    store.save(job, job.stage !== before ? `${before} → ${job.stage}${job.error ? ` (${job.error})` : ""}` : job.error ?? undefined);
    if (wait > 0) await sl(wait);
  }
}

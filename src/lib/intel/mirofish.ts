import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Client for the real MiroFish Flask API (port 5001).
 * Memory is Zep Cloud (ZEP_API_KEY) on that process. The model is whatever
 * OpenAI-compatible key that process was started with (LLM_API_KEY).
 * This desk does not substitute DuckDB, Supabase, or Notion.
 *
 * One Knock walks every step on its own in the background:
 *   ontology -> graph -> create -> prepare -> run (<= 40 rounds) -> report -> done
 * State is saved after every step, so a desk restart resumes the same run.
 * Nothing here is awaited by the heart, the scan, or any order path. The desk never waits on the swarm.
 * Every endpoint below was checked against MiroFish/backend/app/api/{graph,simulation,report}.py.
 */

function dataDir() {
  return process.env.MIROFISH_DATA_DIR || "/workspace/data";
}
const file = (name: string) => join(dataDir(), name);
const FILE = () => file("mirofish-latest.json");
const STATE = () => file("mirofish-state.json");
const SPARK = () => file("spark-latest.json");

/** README: keep runs under 40 rounds. They spend money. */
export const MAX_ROUNDS_CAP = 40;
export const MAX_ROUNDS_DEFAULT = 15;

export function maxRounds(raw: string | undefined = process.env.MIROFISH_MAX_ROUNDS): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return MAX_ROUNDS_DEFAULT;
  return Math.min(MAX_ROUNDS_CAP, n);
}

export type MiroStage = "idle" | "ontology" | "graph" | "create" | "prepare" | "run" | "report" | "done" | "error";
const ACTIVE: MiroStage[] = ["ontology", "graph", "create", "prepare", "run", "report"];
/** Rough share of the whole knock each stage covers, for the progress bar. */
const BAND: Record<MiroStage, [number, number]> = {
  idle: [0, 0],
  ontology: [0, 10],
  graph: [10, 30],
  create: [30, 32],
  prepare: [32, 50],
  run: [50, 85],
  report: [85, 100],
  done: [100, 100],
  error: [0, 0],
};

export type MiroRead = {
  headline: string;
  probability: number | null;
  at: number;
  source: string;
  stage: string;
};

export type MiroState = {
  knockId: string;
  headline: string;
  stage: MiroStage;
  failedAt: string;
  projectId: string;
  graphTask: string;
  graphId: string;
  simulationId: string;
  prepTask: string;
  runStarted: boolean;
  maxRounds: number;
  round: number;
  totalRounds: number;
  actions: number;
  reportId: string;
  reportTask: string;
  stageProgress: number;
  progress: number;
  message: string;
  error: string;
  retries: number;
  probability: number | null;
  probabilityLine: string;
  startedAt: number;
  finishedAt: number;
  heartbeatAt: number;
  at: number;
};

const EMPTY: MiroState = {
  knockId: "",
  headline: "",
  stage: "idle",
  failedAt: "",
  projectId: "",
  graphTask: "",
  graphId: "",
  simulationId: "",
  prepTask: "",
  runStarted: false,
  maxRounds: 0,
  round: 0,
  totalRounds: 0,
  actions: 0,
  reportId: "",
  reportTask: "",
  stageProgress: 0,
  progress: 0,
  message: "",
  error: "",
  retries: 0,
  probability: null,
  probabilityLine: "",
  startedAt: 0,
  finishedAt: 0,
  heartbeatAt: 0,
  at: 0,
};

function base() {
  return (process.env.MIROFISH_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull a 0–1 probability out of a report, only from an explicitly labeled line:
 *   "Probability: 62%", "**Swarm probability (continuation):** 0.62", "概率：62%".
 * An unlabeled "80% of agents" or "p = 0.42" is not read. The last labeled value wins.
 * No labeled number means unknown (null). Nothing is invented.
 */
export function probabilityFromReport(text: string): number | null {
  const clean = String(text || "").replace(/[*_`]/g, "");
  const re = /(?:\bprobability\b|概率)[^\n:=：]{0,48}[:=：]\s*(\d{1,3}(?:\.\d+)?)\s*(%|percent\b)?/gi;
  let out: number | null = null;
  for (const m of clean.matchAll(re)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (m[2]) {
      if (n >= 0 && n <= 100) out = Number((n / 100).toFixed(4));
    } else if (n >= 0 && n <= 1) {
      out = Number(n.toFixed(4));
    }
  }
  return out;
}

function probabilityLineOf(text: string): string {
  const lines = String(text || "").split(/\n/).filter((l) => /probability|概率/i.test(l));
  return (lines[lines.length - 1] ?? "").trim().slice(0, 240);
}

function readState(): MiroState {
  try {
    if (!existsSync(STATE())) return { ...EMPTY };
    const raw = JSON.parse(readFileSync(STATE(), "utf8")) as Partial<MiroState>;
    const s = { ...EMPTY, ...raw };
    if (!["idle", "done", "error", ...ACTIVE].includes(s.stage)) s.stage = "idle";
    return s;
  } catch {
    return { ...EMPTY };
  }
}

function writeAtomic(path: string, body: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}

function writeBoth(state: MiroState) {
  mkdirSync(dataDir(), { recursive: true });
  state.at = Date.now();
  const [lo, hi] = BAND[state.stage];
  if (ACTIVE.includes(state.stage)) state.progress = Math.round(lo + ((hi - lo) * Math.min(100, Math.max(0, state.stageProgress))) / 100);
  else if (state.stage === "done") state.progress = 100;
  writeAtomic(STATE(), JSON.stringify(state));
  const row: MiroRead = {
    headline: state.headline,
    probability: state.probability,
    at: state.at,
    source: base(),
    stage: state.stage === "error" ? `error: ${state.error}` : state.stage,
  };
  writeAtomic(FILE(), JSON.stringify(row));
}

export function readMirofish(): MiroRead | null {
  try {
    if (!existsSync(FILE())) return null;
    const raw = JSON.parse(readFileSync(FILE(), "utf8")) as MiroRead;
    if (!raw || typeof raw.headline !== "string") return null;
    if (Date.now() - Number(raw.at) > 6 * 60 * 60 * 1000) return null;
    return raw;
  } catch {
    return null;
  }
}

/** What the last knock saved. This does not call the town and does not invent a probability. */
export function miroSnapshot() {
  const s = readState();
  return {
    url: base(),
    knockId: s.knockId,
    headline: s.headline,
    stage: s.stage,
    running: ACTIVE.includes(s.stage),
    failedAt: s.failedAt,
    progress: s.progress,
    stageProgress: s.stageProgress,
    message: s.message,
    error: s.error,
    probability: s.probability,
    probabilityLine: s.probabilityLine,
    rounds: { current: s.round, total: s.totalRounds, cap: s.maxRounds || maxRounds() },
    actions: s.actions,
    projectId: s.projectId,
    graphId: s.graphId,
    simulationId: s.simulationId,
    reportId: s.reportId,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    at: s.at,
  };
}

/** True only when something on port 5001 answers. A refusal is down, not a guess. */
export async function probeMirofish(): Promise<{ up: boolean; url: string; detail: string }> {
  const url = base();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { up: res.status < 500, url, detail: `http ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "down";
    return { up: false, url, detail: msg };
  }
}

function sparkHeadline() {
  try {
    if (!existsSync(SPARK())) return "";
    const raw = JSON.parse(readFileSync(SPARK(), "utf8")) as { card?: { event?: string; why?: string } };
    return (raw.card?.event || raw.card?.why || "").trim();
  } catch {
    return "";
  }
}

class TownError extends Error {
  readonly status: number;
  readonly transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

type Resp = { status: number; data: Record<string, unknown> };

/** Every MiroFish answer is {success, data, error}. Ids live under `data`. */
async function call(path: string, init: RequestInit & { timeoutMs: number }): Promise<Resp> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { "Accept-Language": "en", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    throw new TownError(`${path} unreachable (${msg})`, 0, true);
  }
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: unknown; error?: unknown };
  const data = body && typeof body.data === "object" && body.data ? (body.data as Record<string, unknown>) : {};
  if (!res.ok || body.success === false) {
    const err = typeof body.error === "string" ? body.error.slice(0, 300) : `http ${res.status}`;
    throw new TownError(`${path} ${res.status}: ${err}`, res.status, res.status === 409 || res.status >= 502);
  }
  return { status: res.status, data };
}

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const str = (v: unknown) => (typeof v === "string" ? v : "");

function requirement(headline: string) {
  return (
    `Seed headline: ${headline}\n` +
    "Question: after this headline, does the next move in gold and bitcoin continue in the same direction over the next few hours? " +
    "Simulate how traders and observers react. " +
    "The report MUST end with one line in exactly this form: `Probability: NN%` where NN is the share (0-100) of the simulated crowd " +
    "that expects the move to continue. If the simulation cannot support a number, write `Probability: unknown`."
  );
}

const POLL_MS = () => Math.max(100, Number(process.env.MIROFISH_POLL_MS) || 5000);

/** One step of the state machine. Returns how long to wait before the next step. */
export async function stepMirofish(s: MiroState): Promise<number> {
  switch (s.stage) {
    case "ontology": {
      // graph.py generate_ontology: multipart, LLM call, ~40s+. Returns data.project_id.
      s.message = "reading the headline into an ontology (one LLM call)";
      const form = new FormData();
      form.append("simulation_requirement", requirement(s.headline));
      form.append("project_name", `macromiro-${s.knockId}`);
      form.append("files", new Blob([s.headline], { type: "text/plain" }), "seed.txt");
      const r = await call("/api/graph/ontology/generate", { method: "POST", body: form, timeoutMs: 300_000 });
      s.projectId = str(r.data.project_id);
      if (!s.projectId) throw new TownError("ontology answered without data.project_id", r.status, false);
      s.stage = "graph";
      s.stageProgress = 0;
      return 0;
    }
    case "graph": {
      if (!s.graphTask) {
        // graph.py build_graph: returns data.task_id (and data.graph_id when reusing).
        const r = await call("/api/graph/build", { ...json({ project_id: s.projectId }), timeoutMs: 120_000 });
        s.graphTask = str(r.data.task_id);
        s.graphId = str(r.data.graph_id) || s.graphId;
        if (!s.graphTask) throw new TownError("graph build answered without data.task_id", r.status, false);
        s.message = "building the Zep graph";
        return POLL_MS();
      }
      // graph.py get_task: data = task.to_dict() {status pending|processing|completed|failed, progress, message, result}
      try {
        const r = await call(`/api/graph/task/${encodeURIComponent(s.graphTask)}`, { timeoutMs: 20_000 });
        const status = str(r.data.status);
        s.stageProgress = num(r.data.progress) ?? s.stageProgress;
        s.message = str(r.data.message) || s.message;
        const result = (r.data.result ?? {}) as Record<string, unknown>;
        s.graphId = str(result.graph_id) || s.graphId;
        if (status === "failed") throw new TownError(`graph build failed: ${str(r.data.error).slice(0, 300)}`, 200, false);
        if (status !== "completed") return POLL_MS();
      } catch (e) {
        // Tasks live in MiroFish memory. After a town restart, the project record is the truth.
        if (!(e instanceof TownError) || e.status !== 404) throw e;
        const p = await call(`/api/graph/project/${encodeURIComponent(s.projectId)}`, { timeoutMs: 20_000 });
        const status = str(p.data.status);
        s.graphId = str(p.data.graph_id) || s.graphId;
        if (status === "failed") throw new TownError(`graph build failed: ${str(p.data.error).slice(0, 300)}`, 200, false);
        if (status !== "graph_completed") return POLL_MS();
      }
      s.stage = "create";
      s.stageProgress = 0;
      return 0;
    }
    case "create": {
      // simulation.py create_simulation: data = state.to_dict() with simulation_id. Twitter only, to halve the spend.
      const r = await call("/api/simulation/create", {
        ...json({ project_id: s.projectId, graph_id: s.graphId || undefined, enable_twitter: true, enable_reddit: false }),
        timeoutMs: 60_000,
      });
      s.simulationId = str(r.data.simulation_id);
      if (!s.simulationId) throw new TownError("create answered without data.simulation_id", r.status, false);
      s.stage = "prepare";
      s.stageProgress = 0;
      s.message = "simulation created";
      return 0;
    }
    case "prepare": {
      if (!s.prepTask) {
        // simulation.py prepare_simulation: reads Zep entities synchronously, then data.task_id (or already_prepared).
        s.message = "preparing agent profiles";
        const r = await call("/api/simulation/prepare", {
          ...json({ simulation_id: s.simulationId, parallel_profile_count: 3 }),
          timeoutMs: 240_000,
        });
        if (r.data.already_prepared === true) {
          s.stage = "run";
          s.stageProgress = 0;
          return 0;
        }
        s.prepTask = str(r.data.task_id) || "unknown";
        return POLL_MS();
      }
      // simulation.py get_prepare_status: POST /api/simulation/prepare/status {task_id, simulation_id}
      const r = await call("/api/simulation/prepare/status", {
        ...json({ task_id: s.prepTask === "unknown" ? undefined : s.prepTask, simulation_id: s.simulationId }),
        timeoutMs: 30_000,
      });
      const status = str(r.data.status);
      s.stageProgress = num(r.data.progress) ?? s.stageProgress;
      s.message = str(r.data.message) || s.message;
      if (status === "failed") throw new TownError(`prepare failed: ${str(r.data.error).slice(0, 300)}`, 200, false);
      if (status === "ready" || status === "completed" || r.data.already_prepared === true) {
        s.stage = "run";
        s.stageProgress = 0;
        return 0;
      }
      return POLL_MS();
    }
    case "run": {
      if (!s.runStarted) {
        // A start that timed out on our side may still have started over there. Look before starting again.
        const seen = await call(`/api/simulation/${encodeURIComponent(s.simulationId)}/run-status`, { timeoutMs: 20_000 }).catch(() => null);
        const already = seen ? str(seen.data.runner_status) : "";
        if (already && already !== "idle") {
          s.runStarted = true;
          return 0;
        }
        // simulation.py start_simulation: {simulation_id, platform, max_rounds}. Start exactly once.
        s.maxRounds = maxRounds();
        const r = await call("/api/simulation/start", {
          ...json({ simulation_id: s.simulationId, platform: "twitter", max_rounds: s.maxRounds }),
          timeoutMs: 120_000,
        });
        s.runStarted = true;
        s.maxRounds = num(r.data.max_rounds_applied) ?? s.maxRounds;
        s.message = `swarm running, cap ${s.maxRounds} rounds`;
        return POLL_MS();
      }
      // simulation.py get_run_status: GET /api/simulation/<id>/run-status -> data.runner_status, current_round, total_rounds
      const r = await call(`/api/simulation/${encodeURIComponent(s.simulationId)}/run-status`, { timeoutMs: 20_000 });
      const status = str(r.data.runner_status);
      s.round = num(r.data.current_round) ?? s.round;
      s.totalRounds = num(r.data.total_rounds) ?? s.totalRounds;
      s.actions = num(r.data.total_actions_count) ?? s.actions;
      s.stageProgress = num(r.data.progress_percent) ?? s.stageProgress;
      s.message = `round ${s.round}/${s.totalRounds || s.maxRounds} · ${s.actions} agent actions · ${status}`;
      if (status === "failed") throw new TownError(`simulation failed: ${str(r.data.error).slice(0, 300)}`, 200, false);
      if (status === "completed" || status === "stopped") {
        s.stage = "report";
        s.stageProgress = 0;
        return 0;
      }
      // The OASIS scripts flip env_status to "alive" only after the round loop ends (then they idle for
      // interview commands). Some script paths never log simulation_end, so run-status would say
      // "running" forever. simulation.py get_env_status + stop_simulation close that gap.
      if (status === "running") {
        const env = await call("/api/simulation/env-status", { ...json({ simulation_id: s.simulationId }), timeoutMs: 15_000 }).catch(() => null);
        if (env?.data.env_alive === true) {
          s.message = `round loop finished (${s.round}/${s.totalRounds || s.maxRounds}) · closing the town's idle env`;
          await call("/api/simulation/stop", { ...json({ simulation_id: s.simulationId }), timeoutMs: 120_000 });
          return 1000;
        }
      }
      return POLL_MS();
    }
    case "report": {
      if (!s.reportId) {
        // report.py generate_report: data.report_id + data.task_id, or already_generated. 409 while ingestion settles.
        const r = await call("/api/report/generate", { ...json({ simulation_id: s.simulationId }), timeoutMs: 60_000 });
        s.reportId = str(r.data.report_id);
        s.reportTask = r.data.already_generated === true ? "" : str(r.data.task_id);
        if (!s.reportId) throw new TownError("report answered without data.report_id", r.status, false);
        s.message = "writing the report";
        return s.reportTask ? POLL_MS() : 0;
      }
      if (s.reportTask) {
        // report.py get_generate_status: POST /api/report/generate/status {task_id, simulation_id}
        const r = await call("/api/report/generate/status", {
          ...json({ task_id: s.reportTask, simulation_id: s.simulationId }),
          timeoutMs: 30_000,
        });
        const status = str(r.data.status);
        s.stageProgress = num(r.data.progress) ?? s.stageProgress;
        s.message = str(r.data.message) || s.message;
        if (status === "failed") throw new TownError(`report failed: ${str(r.data.error).slice(0, 300)}`, 200, false);
        if (status !== "completed") return POLL_MS();
        s.reportId = str(r.data.report_id) || s.reportId;
        s.reportTask = "";
      }
      // report.py get_report: GET /api/report/<report_id> -> data.markdown_content
      const r = await call(`/api/report/${encodeURIComponent(s.reportId)}`, { timeoutMs: 30_000 });
      const md = str(r.data.markdown_content);
      s.probability = probabilityFromReport(md);
      s.probabilityLine = probabilityLineOf(md);
      s.stage = "done";
      s.stageProgress = 100;
      s.finishedAt = Date.now();
      s.message = s.probability == null ? "report done · no labeled probability · null" : "report done";
      return 0;
    }
    default:
      return 0;
  }
}

type G = typeof globalThis & { __miroRunner?: { knockId: string; promise: Promise<void> } };
const g = globalThis as G;

const MAX_RETRIES = 8;
const maxRunMs = () => Math.max(5, Number(process.env.MIROFISH_MAX_MINUTES) || 45) * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function downNote(msg: string) {
  return /unreachable|ECONNREFUSED|fetch failed/i.test(msg)
    ? `MiroFish is not answering on ${base()}. The desk keeps running. Nothing was invented. (${msg})`
    : msg;
}

async function drive(knockId: string) {
  while (true) {
    const s = readState();
    if (s.knockId !== knockId || !ACTIVE.includes(s.stage)) return;
    if (Date.now() - s.startedAt > maxRunMs()) {
      Object.assign(s, { failedAt: s.stage, stage: "error", error: `knock ran past ${maxRunMs() / 60_000} minutes; stopped following it` });
      writeBoth(s);
      return;
    }
    let wait = 0;
    try {
      wait = await stepMirofish(s);
      s.error = "";
      s.retries = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient = e instanceof TownError ? e.transient : true;
      s.retries += 1;
      if (transient && s.retries <= MAX_RETRIES) {
        s.error = `retry ${s.retries}/${MAX_RETRIES}: ${downNote(msg)}`;
        wait = POLL_MS() * Math.min(4, s.retries);
      } else {
        s.failedAt = s.stage;
        s.stage = "error";
        s.error = downNote(msg);
        s.finishedAt = Date.now();
      }
      s.probability = null;
    }
    s.heartbeatAt = Date.now();
    // Never write over a newer knock.
    if (readState().knockId !== knockId) return;
    writeBoth(s);
    if (wait > 0) await sleep(wait);
  }
}

function ensureRunner(knockId: string) {
  if (g.__miroRunner && g.__miroRunner.knockId === knockId) return;
  const promise = drive(knockId)
    .catch(() => undefined)
    .finally(() => {
      if (g.__miroRunner?.knockId === knockId) g.__miroRunner = undefined;
    });
  g.__miroRunner = { knockId, promise };
}

/** Pick a run that was in flight before a restart back up. Never starts a new one. Never awaited. */
export function resumeMirofish() {
  const s = readState();
  if (s.knockId && ACTIVE.includes(s.stage)) ensureRunner(s.knockId);
  return miroSnapshot();
}

/**
 * Knock once. Starts the background walk and returns at once.
 * A knock already in flight is not doubled. A finished read for the same headline (under 6h) is reused unless force.
 */
export function knockMirofish(opts: { force?: boolean } = {}) {
  const cur = readState();
  if (cur.knockId && ACTIVE.includes(cur.stage)) {
    ensureRunner(cur.knockId);
    return { started: false, reason: `knock ${cur.knockId} already at ${cur.stage}`, snap: miroSnapshot() };
  }
  const headline = sparkHeadline();
  if (!headline) {
    Object.assign(cur, { stage: "error", failedAt: "idle", error: "no spark headline yet", probability: null });
    writeBoth(cur);
    return { started: false, reason: "no spark headline yet", snap: miroSnapshot() };
  }
  if (!opts.force && cur.stage === "done" && cur.headline === headline && Date.now() - cur.finishedAt < 6 * 60 * 60 * 1000) {
    return { started: false, reason: "this headline already has a finished read (send force to rerun; it spends money)", snap: miroSnapshot() };
  }
  const now = Date.now();
  const s: MiroState = { ...EMPTY, knockId: `k${now.toString(36)}`, headline, stage: "ontology", maxRounds: maxRounds(), startedAt: now, heartbeatAt: now };
  writeBoth(s);
  ensureRunner(s.knockId);
  return { started: true, reason: "knock started", snap: miroSnapshot() };
}

/** Kept for older callers (perp scan). Resumes a run in flight; never starts or waits on one. */
export async function syncMirofish(): Promise<MiroRead | null> {
  resumeMirofish();
  return readMirofish();
}

export type SwarmAction = {
  round: number;
  at: string;
  platform: string;
  agentId: number | null;
  agent: string;
  type: string;
  text: string;
  ok: boolean;
};

function actionText(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const t = a.content ?? a.text ?? a.query ?? a.post_content ?? a.comment ?? "";
  return String(t).slice(0, 280);
}

/**
 * Read-only relay of what the swarm is doing right now, for the swarm panel.
 * MiroFish exposes: GET /api/simulation/<id>/run-status (round/actions counters),
 * GET /api/simulation/<id>/actions?limit&offset (agent actions, newest first),
 * GET /api/simulation/<id>/timeline (per-round summary). No push stream exists; this polls.
 */
export async function swarmFeed(limit = 50) {
  const snap = miroSnapshot();
  const out = {
    sendsOrders: false as const,
    snap,
    status: null as Record<string, unknown> | null,
    actions: [] as SwarmAction[],
    timeline: [] as { round: number; actions: number; agents: number; types: Record<string, number> }[],
    error: "",
  };
  if (!snap.simulationId) return out;
  const id = encodeURIComponent(snap.simulationId);
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 50));
  const [st, ac, tl] = await Promise.allSettled([
    call(`/api/simulation/${id}/run-status`, { timeoutMs: 5000 }),
    call(`/api/simulation/${id}/actions?limit=${n}`, { timeoutMs: 5000 }),
    call(`/api/simulation/${id}/timeline`, { timeoutMs: 5000 }),
  ]);
  if (st.status === "fulfilled") {
    const d = st.value.data;
    out.status = {
      runner: d.runner_status,
      round: d.current_round,
      totalRounds: d.total_rounds,
      percent: d.progress_percent,
      actions: d.total_actions_count,
      simulatedHours: d.simulated_hours,
    };
  }
  if (ac.status === "fulfilled") {
    const rows = Array.isArray(ac.value.data.actions) ? (ac.value.data.actions as Record<string, unknown>[]) : [];
    out.actions = rows.map((a) => ({
      round: num(a.round_num) ?? 0,
      at: str(a.timestamp),
      platform: str(a.platform),
      agentId: num(a.agent_id),
      agent: str(a.agent_name),
      type: str(a.action_type),
      text: actionText(a.action_args),
      ok: a.success !== false,
    }));
  }
  if (tl.status === "fulfilled") {
    const rows = Array.isArray(tl.value.data.timeline) ? (tl.value.data.timeline as Record<string, unknown>[]) : [];
    out.timeline = rows.map((r) => ({
      round: num(r.round_num) ?? 0,
      actions: (num(r.twitter_actions) ?? 0) + (num(r.reddit_actions) ?? 0),
      agents: num(r.active_agents_count) ?? (Array.isArray(r.active_agents) ? r.active_agents.length : 0),
      types: (r.action_types as Record<string, number>) ?? {},
    }));
  }
  const failed = [st, ac, tl].find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
  if (failed) out.error = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
  return out;
}

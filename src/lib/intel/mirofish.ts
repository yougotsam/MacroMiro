import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Client for the real MiroFish Flask API (port 5001).
 * Memory is Zep Cloud (ZEP_API_KEY) on that process. The model is whatever
 * OpenAI-compatible key that process was started with (LLM_API_KEY).
 * This desk does not substitute DuckDB, Supabase, or Notion.
 */

const FILE = "/workspace/data/mirofish-latest.json";
const STATE = "/workspace/data/mirofish-state.json";
const SPARK = "/workspace/data/spark-latest.json";

export type MiroRead = {
  headline: string;
  probability: number | null;
  at: number;
  source: string;
  stage: string;
};

type MiroState = {
  headline: string;
  stage: string;
  projectId: string;
  graphTask: string;
  simulationId: string;
  prepTask: string;
  reportId: string;
  error: string;
  probability: number | null;
  at: number;
};

const EMPTY: MiroState = {
  headline: "",
  stage: "idle",
  projectId: "",
  graphTask: "",
  simulationId: "",
  prepTask: "",
  reportId: "",
  error: "",
  probability: null,
  at: 0,
};

function base() {
  return (process.env.MIROFISH_URL || "http://127.0.0.1:5001").replace(/\/+$/, "");
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pull a 0–1 probability out of a report. 80% and 0.8 both count. No number means unknown. */
export function probabilityFromReport(text: string): number | null {
  const pct = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (pct) {
    const n = Number(pct[1]);
    if (n >= 0 && n <= 100) return Number((n / 100).toFixed(4));
  }
  const dec = text.match(/\b(0\.\d{2,4})\b/);
  if (dec) {
    const n = Number(dec[1]);
    if (n >= 0 && n <= 1) return n;
  }
  return null;
}

function readState(): MiroState {
  try {
    if (!existsSync(STATE)) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(readFileSync(STATE, "utf8")) as Partial<MiroState>) };
  } catch {
    return { ...EMPTY };
  }
}

function writeBoth(state: MiroState) {
  mkdirSync("/workspace/data", { recursive: true });
  state.at = Date.now();
  writeFileSync(STATE, JSON.stringify(state));
  const row: MiroRead = {
    headline: state.headline,
    probability: state.probability,
    at: state.at,
    source: base(),
    stage: state.error ? `error: ${state.error}` : state.stage,
  };
  writeFileSync(FILE, JSON.stringify(row));
}

export function readMirofish(): MiroRead | null {
  try {
    if (!existsSync(FILE)) return null;
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as MiroRead;
    if (!raw || typeof raw.headline !== "string") return null;
    if (Date.now() - Number(raw.at) > 6 * 60 * 60 * 1000) return null;
    return raw;
  } catch {
    return null;
  }
}

function sparkHeadline() {
  try {
    if (!existsSync(SPARK)) return "";
    const raw = JSON.parse(readFileSync(SPARK, "utf8")) as { card?: { event?: string; why?: string } };
    return (raw.card?.event || raw.card?.why || "").trim();
  } catch {
    return "";
  }
}

async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

function idOf(data: Record<string, unknown>, key: string) {
  const v = data[key];
  return typeof v === "string" ? v : "";
}

/** One real step per pass. A down server is an error, not a made-up probability. */
export async function syncMirofish(): Promise<MiroRead | null> {
  const headline = sparkHeadline();
  const state = readState();
  if (!headline) {
    state.error = "no spark headline yet";
    writeBoth(state);
    return readMirofish();
  }
  if (state.headline !== headline) {
    Object.assign(state, { ...EMPTY, headline });
  }
  if (state.stage === "done" && state.probability != null && Date.now() - state.at < 6 * 60 * 60 * 1000) {
    return readMirofish();
  }
  try {
    if (state.stage === "idle") {
      const form = new FormData();
      form.append("simulation_requirement", "Will the next move in gold and bitcoin continue after this headline? Return one probability.");
      form.append("files", new Blob([headline], { type: "text/plain" }), "seed.txt");
      const res = await call("/api/graph/ontology/generate", { method: "POST", body: form });
      if (!res.ok) throw new Error(`ontology ${res.status}`);
      state.projectId = idOf(res.data, "project_id") || idOf(res.data, "projectId");
      state.stage = "graph";
    } else if (state.stage === "graph" && !state.graphTask) {
      const res = await call("/api/graph/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: state.projectId }),
      });
      if (!res.ok) throw new Error(`graph build ${res.status}`);
      state.graphTask = idOf(res.data, "task_id") || idOf(res.data, "taskId");
    } else if (state.stage === "graph") {
      const res = await call(`/api/graph/task/${encodeURIComponent(state.graphTask)}`);
      if (!res.ok) throw new Error(`graph task ${res.status}`);
      const progress = num(res.data.progress) ?? 0;
      if (progress >= 100 || res.data.phase === "done" || res.data.status === "completed") state.stage = "prepare";
    } else if (state.stage === "prepare" && !state.simulationId) {
      const res = await call("/api/simulation/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: state.projectId, simulation_requirements: headline }),
      });
      if (!res.ok) throw new Error(`simulation create ${res.status}`);
      state.simulationId = idOf(res.data, "simulation_id") || idOf(res.data, "simulationId");
    } else if (state.stage === "prepare" && !state.prepTask) {
      const res = await call("/api/simulation/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: state.simulationId }),
      });
      if (!res.ok) throw new Error(`prepare ${res.status}`);
      state.prepTask = idOf(res.data, "task_id") || "started";
    } else if (state.stage === "prepare") {
      const res = await call(`/api/simulation/task_status?taskId=${encodeURIComponent(state.prepTask)}`);
      if (!res.ok) throw new Error(`prepare status ${res.status}`);
      const status = String(res.data.status ?? "");
      if (status === "completed" || status === "ready" || num(res.data.progress) === 100) state.stage = "run";
    } else if (state.stage === "run") {
      const res = await call("/api/simulation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: state.simulationId, platform: "twitter" }),
      });
      if (!res.ok && res.status !== 409) throw new Error(`start ${res.status}`);
      const watch = await call(`/api/simulation/run_status?simulationId=${encodeURIComponent(state.simulationId)}`);
      const status = String(watch.data.status ?? "");
      if (status === "completed" || status === "finished" || status === "stopped") state.stage = "report";
    } else if (state.stage === "report") {
      const res = await call("/api/report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulation_id: state.simulationId }),
      });
      if (!res.ok && res.status !== 409) throw new Error(`report ${res.status}`);
      state.reportId = idOf(res.data, "report_id") || state.simulationId;
      const status = await call("/api/report/generate/status");
      const outline = String(status.data.report_outline ?? status.data.log ?? "");
      const p = probabilityFromReport(outline);
      if (status.data.isComplete === true || p != null) {
        state.probability = p;
        state.stage = "done";
      }
    }
    state.error = "";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.error = /fetch|ECONNREFUSED|network/i.test(msg)
      ? "MiroFish is not running. It needs its own LLM_API_KEY and ZEP_API_KEY. This desk does not invent the swarm."
      : msg;
    state.probability = null;
  }
  writeBoth(state);
  return readMirofish();
}

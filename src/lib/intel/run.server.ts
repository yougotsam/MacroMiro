import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { agentStatus, agentTrace, cancelAgent, ensureMonitor, startAgent } from "@/lib/live/firecrawl.server";
import { hostile, orderTrace, shadowUse } from "@/lib/intel/guard";
import { applyFinding, emptyRecord, type CatalystRecord } from "@/lib/intel/record";
import { workflowBody, type WorkflowName } from "@/lib/intel/workflows";
import { DATA_ROOT } from "@/lib/data-root";
import { budgetNow, recordCredits } from "@/lib/intel/budget.server";

const NAMES: WorkflowName[] = ["verify", "hunter", "contradict", "analogue", "contract"];
const DIR = `${DATA_ROOT}/intel`;
const SHADOW = `${DATA_ROOT}/shadow-intel.jsonl`;
const STALE_MS = 8 * 60_000;

type TraceEvent = {
  eventId?: string;
  type?: string;
  producerSequence?: number;
  occurredAt?: string;
  agent?: { id?: string; name?: string };
  artifact?: { snapshotId?: string };
};

export type IntelFile = {
  record: CatalystRecord;
  trace: { eventId?: string; type?: string; occurredAt?: string; agent?: string }[];
  quotes: string[];
  urls: string[];
  snapshots: string[];
  liveView: string;
  expiresAt: string | null;
  shadow: { apply: boolean; delta: number | null; reason: string };
  error: string;
};

export type IntelBoard = {
  runs: Partial<Record<WorkflowName, IntelFile>>;
  monitor: { id: string | null; status: string; checks: number; error: string };
  reaction: { line: string; sample: string; trade: false } | null;
};

function blank(name: string): IntelFile {
  const now = new Date().toISOString();
  return {
    record: emptyRecord(name, now),
    trace: [],
    quotes: [],
    urls: [],
    snapshots: [],
    liveView: "",
    expiresAt: null,
    shadow: { apply: false, delta: null, reason: "missing news is unknown" },
    error: "",
  };
}

function pathFor(name: WorkflowName) {
  return `${DIR}/${name}.json`;
}

export function readRun(name: WorkflowName): IntelFile {
  try {
    return JSON.parse(readFileSync(pathFor(name), "utf8")) as IntelFile;
  } catch {
    return blank(name);
  }
}

export function readIntel(): IntelBoard {
  const runs: IntelBoard["runs"] = {};
  for (const name of NAMES) {
    const row = readRun(name);
    if (row.record.sparkJobIds.length || row.record.headline) runs[name] = row;
  }
  let monitor = { id: null as string | null, status: "not created", checks: 0, error: "" };
  try {
    monitor = JSON.parse(readFileSync(`${DATA_ROOT}/monitor.json`, "utf8"));
  } catch {
    /* none yet */
  }
  let reaction: IntelBoard["reaction"] = null;
  try {
    reaction = JSON.parse(readFileSync(`${DIR}/reaction.json`, "utf8"));
  } catch {
    /* not measured yet */
  }
  return { runs, monitor, reaction };
}

function save(name: WorkflowName, file: IntelFile) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(pathFor(name), JSON.stringify(file));
  appendFileSync(
    SHADOW,
    `${JSON.stringify({ at: new Date().toISOString(), workflow: name, job: file.record.sparkJobIds[0] ?? null, credits: file.record.creditsUsed, headline: file.record.headline, delta: file.record.experimentalProbabilityDelta, apply: file.shadow.apply, reason: file.shadow.reason, trade: false })}\n`,
  );
  if (file.record.phase === "done") recordCredits(`fc_clerks:${name}`, file.record.creditsUsed, new Date(), file.record.sparkJobIds[0]);
}

function creditsOf(status: number | null, trace: number | null) {
  const a = status ?? 0;
  const b = trace ?? 0;
  return Math.max(a, b);
}

function findingFrom(name: WorkflowName, data: unknown) {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const urls = [
    ...(Array.isArray(row.urls) ? row.urls : []),
    ...(typeof row.url === "string" ? [row.url] : []),
  ].filter((u): u is string => typeof u === "string");
  const quotes = [
    ...(Array.isArray(row.quotes) ? row.quotes : []),
    ...(typeof row.quote === "string" ? [row.quote] : []),
  ].filter((q): q is string => typeof q === "string");
  if (name === "contradict") {
    return {
      headline: typeof row.headline === "string" ? row.headline : "contradiction check",
      summary: Array.isArray(row.reasons) ? row.reasons.filter((x): x is string => typeof x === "string").join(" ") : "",
      asset: "both",
      quotes,
      urls,
      bullish: [],
      bearish: Array.isArray(row.reasons) ? row.reasons.filter((x): x is string => typeof x === "string") : [],
      recycled: row.recycled === true,
      rulesChanged: false,
    };
  }
  if (name === "analogue") {
    const events = Array.isArray(row.events) ? row.events.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : [];
    const first = events[0];
    const date = typeof row.analogueDate === "string" ? row.analogueDate : typeof first?.analogueDate === "string" ? first.analogueDate : "";
    const bits = events.map((event) => {
      const when = typeof event.analogueDate === "string" ? event.analogueDate : "undated";
      const actual = typeof event.actual === "string" ? event.actual : "no printed result";
      return `${when}: ${actual}`;
    });
    const diffs = [
      ...(Array.isArray(row.differences) ? row.differences : []),
      ...events.flatMap((event) => (Array.isArray(event.differences) ? event.differences : [])),
    ].filter((x): x is string => typeof x === "string");
    return {
      headline: date ? `Analogue ${date}` : "analogue",
      summary: [...bits, ...diffs].join(" "),
      asset: "both",
      quotes,
      urls,
      bullish: [],
      bearish: [],
      recycled: false,
      rulesChanged: false,
    };
  }
  if (name === "contract") {
    return {
      headline: typeof row.settlementLanguage === "string" ? row.settlementLanguage.slice(0, 180) : "contract",
      summary: typeof row.dataReference === "string" ? row.dataReference : "",
      asset: "btc",
      quotes,
      urls,
      bullish: [],
      bearish: [],
      recycled: false,
      rulesChanged: row.rulesChanged === true,
    };
  }
  const bull = Array.isArray(row.supporting) ? row.supporting.filter((x): x is string => typeof x === "string") : Array.isArray(row.bullish) ? row.bullish.filter((x): x is string => typeof x === "string") : [];
  const bear = Array.isArray(row.contradictions) ? row.contradictions.filter((x): x is string => typeof x === "string") : Array.isArray(row.bearish) ? row.bearish.filter((x): x is string => typeof x === "string") : [];
  return {
    headline: typeof row.event === "string" ? row.event : typeof row.headline === "string" ? row.headline : "",
    summary: typeof row.summary === "string" ? row.summary : typeof row.releaseTime === "string" ? row.releaseTime : "",
    asset: typeof row.asset === "string" ? row.asset : "unclear",
    quotes,
    urls,
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    bullish: bull,
    bearish: bear,
    recycled: row.novelty === "recycled" || row.recycled === true,
    rulesChanged: row.rulesChanged === true,
  };
}

function fold(name: WorkflowName, file: IntelFile, job: { status: string; data: unknown; creditsUsed: number | null; error: string; expiresAt?: string | null }, trace: { events: unknown[]; creditsUsed: number | null; live: string }) {
  const events = orderTrace((trace.events ?? []) as TraceEvent[]);
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (!e.eventId || seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });
  const expired = Boolean(job.expiresAt && Date.parse(job.expiresAt) < Date.now());
  file.expiresAt = job.expiresAt ?? file.expiresAt;
  file.trace = unique.slice(-12).map((e) => ({ eventId: e.eventId, type: e.type, occurredAt: e.occurredAt, agent: e.agent?.name }));
  file.snapshots = [...new Set(unique.map((e) => e.artifact?.snapshotId).filter((x): x is string => Boolean(x)))];
  file.liveView = trace.live;
  file.record.traceIds = unique.map((e) => e.eventId).filter((x): x is string => Boolean(x));
  file.record.snapshotIds = file.snapshots;
  file.record.creditsUsed = creditsOf(job.creditsUsed, trace.creditsUsed);
  if (expired) {
    file.record.phase = "failed";
    file.error = "result expired";
    file.shadow = { apply: false, delta: null, reason: "spark result expired" };
    return file;
  }
  file.record.phase = job.status === "completed" ? "done" : job.status === "failed" ? "failed" : "working";
  file.error = job.error;
  if (job.status === "completed" && job.data && typeof job.data === "object") {
    const text = JSON.stringify(job.data);
    const found = hostile(text) ? { headline: "dropped", summary: "The page tried to give an instruction.", asset: "unclear", quotes: [], urls: [], bullish: [], bearish: [], recycled: false, rulesChanged: false } : findingFrom(name, job.data);
    const id = file.record.sparkJobIds[0];
    file.record = { ...applyFinding(file.record, { ...found, jobId: id, credits: file.record.creditsUsed }), phase: "done", sparkJobIds: id ? [id] : [], eventType: name };
    file.quotes = file.record.directQuotes;
    file.urls = file.record.sourceUrls;
  }
  file.shadow = shadowUse({
    delta: file.record.experimentalProbabilityDelta,
    contradiction: file.record.contradictionScore,
    primary: file.record.primarySourceUrls.length,
    marketFresh: false,
    hostileText: hostile(file.record.summary),
  });
  return file;
}

export async function armClerks() {
  const names = ["hunter", "verify", "contradict", "analogue"] as const;
  for (const name of names) {
    let run = readRun(name);
    // Collect a finished job before judging it. Without this, a job that completed between
    // 30-minute ticks was cancelled as "timed out" and restarted, spending credits twice.
    if (run.record.phase === "working" && run.record.sparkJobIds[0]) {
      run = await refreshInvestigation(name).catch(() => run);
    }
    const age = Date.now() - Date.parse(run.record.discoveredAt);
    if (run.record.sparkJobIds.length > 0 && Number.isFinite(age) && age < 6 * 60 * 60 * 1000 && run.record.phase !== "failed") continue;
    // Nonessential: suspended while the monthly Firecrawl credit ceiling is hit (FIRECRAWL_MONTHLY_CREDIT_CEILING).
    if (budgetNow().suspendNonessential) return;
    await beginInvestigation(name);
    await new Promise((r) => setTimeout(r, 35_000));
  }
}

export async function beginInvestigation(name: WorkflowName): Promise<IntelFile> {
  const existing = readRun(name);
  const age = Date.now() - Date.parse(existing.record.discoveredAt);
  if (existing.record.phase === "working" && existing.record.sparkJobIds[0] && age < STALE_MS) return existing;
  if (existing.record.phase === "working" && existing.record.sparkJobIds[0] && age >= STALE_MS) {
    await cancelAgent(existing.record.sparkJobIds[0]);
    existing.record.phase = "failed";
    existing.error = "timeout";
    existing.shadow = { apply: false, delta: null, reason: "job timed out" };
    save(name, existing);
  }
  const now = new Date().toISOString();
  const started = await startAgent(workflowBody(name));
  const file = blank(`${name}-${now}`);
  file.record.eventType = name;
  file.record.phase = started.ok ? "working" : "failed";
  if (started.id) file.record.sparkJobIds = [started.id];
  file.error = started.error;
  file.shadow = { apply: false, delta: null, reason: started.ok ? "working" : started.error };
  save(name, file);
  return file;
}

export async function refreshInvestigation(name?: WorkflowName): Promise<IntelFile> {
  const target = name && NAMES.includes(name) ? name : NAMES.find((n) => readRun(n).record.phase === "working") || "verify";
  const file = readRun(target);
  const id = file.record.sparkJobIds[0];
  if (!id) return file;
  const [job, trace] = await Promise.all([agentStatus(id), agentTrace(id)]);
  fold(target, file, job, trace);
  save(target, file);
  return file;
}

export async function cancelInvestigation(name?: WorkflowName) {
  const target = name && NAMES.includes(name) ? name : "verify";
  const file = readRun(target);
  const id = file.record.sparkJobIds[0];
  if (!id) return file;
  await cancelAgent(id);
  file.record.phase = "failed";
  file.error = "cancelled";
  file.shadow = { apply: false, delta: null, reason: "cancelled" };
  save(target, file);
  return file;
}

export async function pollMonitor() {
  const row = await ensureMonitor();
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(`${DATA_ROOT}/monitor.json`, JSON.stringify(row));
  return row;
}

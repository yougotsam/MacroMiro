import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { firecrawlKey, firecrawlReady } from "@/lib/live/firecrawl.server";
import { sparkBody, sparkDate, sparkRead } from "@/lib/live/spark";
import { armClerks } from "@/lib/intel/run.server";
import { DATA_ROOT } from "@/lib/data-root";

const API = "https://api.firecrawl.dev/v2";
const FILE = `${DATA_ROOT}/spark-latest.json`;

type SparkRun = { status: string; id: string | null; creditsUsed: number | null; card: ReturnType<typeof sparkRead>; error: string };
const flight = globalThis as typeof globalThis & { __sparkInflight?: Promise<SparkRun> };

/** One Spark job at a time: a second caller (radar GET, POST, the 30-minute clock) joins the run in flight. */
export function runSparkBrief(): Promise<SparkRun> {
  if (flight.__sparkInflight) return flight.__sparkInflight;
  const p = runSparkOnce().finally(() => {
    if (flight.__sparkInflight === p) flight.__sparkInflight = undefined;
  });
  flight.__sparkInflight = p;
  return p;
}

async function runSparkOnce(): Promise<SparkRun> {
  if (!firecrawlReady()) return { status: "failed", id: null, creditsUsed: null, card: null, error: "no key" };
  const now = new Date();
  const started = await fetch(`${API}/agent`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${firecrawlKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(sparkBody(now)),
  });
  const startJson = (await started.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!started.ok || !startJson.id) {
    const row = { status: "failed", id: null, creditsUsed: null, card: null, error: (startJson.error || `spark http ${started.status}`).slice(0, 300) };
    saveSpark(row, sparkDate(now));
    return row;
  }
  return finishSpark(startJson.id, sparkDate(now));
}

/** Spark /agent jobs usually take 1-5 minutes. Poll every 10 s for up to 8 minutes. */
const POLLS = 48;
const POLL_EVERY_MS = 10_000;

async function finishSpark(id: string, forDate: string) {
  let status = "processing";
  let creditsUsed: number | null = null;
  let card: ReturnType<typeof sparkRead> = null;
  let error = "";
  for (let attempt = 0; attempt < POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 5000 : POLL_EVERY_MS));
    const polled = await fetch(`${API}/agent/${id}`, {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${firecrawlKey()}` },
    }).catch(() => null);
    if (!polled) continue;
    const job = (await polled.json().catch(() => ({}))) as { status?: string; data?: unknown; creditsUsed?: number; error?: string };
    // A rate-limit or gateway answer has no job status. Keep polling.
    if (!polled.ok && !job.status) continue;
    status = job.status || "processing";
    creditsUsed = job.creditsUsed ?? creditsUsed;
    error = job.error || "";
    if (status === "completed") card = sparkRead(job.data);
    if (status === "completed" || status === "failed") break;
  }
  if (status !== "completed" && status !== "failed") {
    status = "timeout";
    error = error || `spark job still running after ${(POLLS * POLL_EVERY_MS) / 60_000} minutes`;
  }
  const row = { status, id, creditsUsed, card, error };
  saveSpark(row, forDate);
  return row;
}

/** A failed or timed-out run never wipes a fresh (< 6 h) completed card off the screen or out of the Knock seed. */
function saveSpark(row: SparkRun, forDate: string) {
  mkdirSync(DATA_ROOT, { recursive: true });
  const prev = readSpark();
  const at = new Date().toISOString();
  if (row.status === "completed" && row.card) {
    writeFileSync(FILE, JSON.stringify({ ...row, forDate, at }));
  } else if (prev?.status === "completed" && prev.card) {
    writeFileSync(FILE, JSON.stringify({ ...prev, lastError: { at, id: row.id ?? "", status: row.status, error: row.error } }));
  } else {
    writeFileSync(FILE, JSON.stringify({ ...row, forDate, at }));
  }
}

let refreshing = false;
let lastKick = 0;

const EVERY = 90 * 60 * 1000;

/** The price loop does not call this. A new reading at most every 90 minutes, even if the screen is closed. */
export function kickSparkIfStale() {
  if (refreshing || Date.now() - lastKick < EVERY) return;
  const row = readSpark();
  const at = Date.parse((row?.at as string | undefined) ?? "");
  if (Number.isFinite(at) && Date.now() - at < EVERY && row?.status === "completed") return;
  refreshing = true;
  lastKick = Date.now();
  void runSparkBrief().finally(() => {
    refreshing = false;
  });
}

const clock = globalThis as typeof globalThis & { __sparkClock?: boolean };
if (!clock.__sparkClock) {
  clock.__sparkClock = true;
  setInterval(() => {
    kickSparkIfStale();
    void armClerks();
  }, 30 * 60 * 1000);
  void armClerks();
}

/** The last Spark card. Older than 6 h (or never completed) comes back with card null and status "expired". */
export function readSpark() {
  try {
    const row = JSON.parse(readFileSync(FILE, "utf8")) as {
      status?: string;
      id?: string;
      creditsUsed?: number | null;
      card?: { event?: string; why?: string; bias?: string; quote?: string; asset?: string; probability?: number | null; headlines?: { title: string; url: string; published: string | null }[] } | null;
      error?: string;
      forDate?: string;
      lastError?: { at: string; id: string; status: string; error: string };
      at?: string;
    };
    const at = Date.parse(row.at ?? "");
    if (!Number.isFinite(at) || Date.now() - at > 6 * 60 * 60 * 1000) {
      return { ...row, card: null, status: "expired" };
    }
    return row;
  } catch {
    return null;
  }
}

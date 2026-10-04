import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { firecrawlKey, firecrawlReady } from "@/lib/live/firecrawl.server";
import { sparkBody, sparkRead } from "@/lib/live/spark";
import { armClerks } from "@/lib/intel/run.server";

const API = "https://api.firecrawl.dev/v2";
const FILE = "/workspace/data/spark-latest.json";

export async function runSparkBrief(): Promise<{ status: string; id: string | null; creditsUsed: number | null; card: ReturnType<typeof sparkRead>; error: string }> {
  if (!firecrawlReady()) return { status: "failed", id: null, creditsUsed: null, card: null, error: "no key" };
  const started = await fetch(`${API}/agent`, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${firecrawlKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(sparkBody()),
  });
  const startJson = (await started.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!started.ok || !startJson.id) {
    return { status: "failed", id: null, creditsUsed: null, card: null, error: startJson.error || `spark http ${started.status}` };
  }
  return finishSpark(startJson.id);
}

async function finishSpark(id: string) {
  let status = "processing";
  let creditsUsed: number | null = null;
  let card: ReturnType<typeof sparkRead> = null;
  let error = "";
  for (let attempt = 0; attempt < 16; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 2500 : 4000));
    const polled = await fetch(`${API}/agent/${id}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${firecrawlKey()}` },
    });
    const job = (await polled.json().catch(() => ({}))) as { status?: string; data?: unknown; creditsUsed?: number; error?: string };
    status = job.status || "processing";
    creditsUsed = job.creditsUsed ?? creditsUsed;
    error = job.error || "";
    if (status === "completed") card = sparkRead(job.data);
    if (status === "completed" || status === "failed") break;
  }
  const row = { status, id, creditsUsed, card, error };
  mkdirSync("/workspace/data", { recursive: true });
  writeFileSync(FILE, JSON.stringify({ ...row, at: new Date().toISOString() }));
  return row;
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

export function readSpark() {
  try {
    const row = JSON.parse(readFileSync(FILE, "utf8")) as {
      status?: string;
      id?: string;
      creditsUsed?: number | null;
      card?: { event?: string; why?: string; bias?: string; quote?: string; asset?: string } | null;
      error?: string;
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

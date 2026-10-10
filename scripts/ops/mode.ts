/**
 * Research operating-mode switch (Sameer's control). Examples:
 *   bun scripts/ops/mode.ts status
 *   bun scripts/ops/mode.ts set FULL_STANDBY            # stop ALL Firecrawl spend, pause every remote monitor (verified)
 *   bun scripts/ops/mode.ts set MARKET_DATA_ONLY        # same Firecrawl rule; Kalshi collector + free calendars keep running
 *   bun scripts/ops/mode.ts set RESEARCH_PAPER --approve legacy_spark_brief,grid_calls
 *   bun scripts/ops/mode.ts resume <monitorId>          # only in RESEARCH_PAPER with grid_monitors or calendar_monitors approved
 * LIVE_TRADING cannot be set here. Never prints keys. Pausing is not deleting.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { readMode, writeMode, MODES, SPEND_JOBS, type Mode } from "../../src/lib/ops/operating-mode";
import { DATA_ROOT } from "../../src/lib/data-root";
import { creditsThisMonth } from "../../src/lib/intel/budget.server";

const KEY = (process.env.FIRECRAWL_API_KEY ?? (existsSync("/workspace/.grok/secrets/fc") ? readFileSync("/workspace/.grok/secrets/fc", "utf8") : "")).trim();
const API = "https://api.firecrawl.dev/v2";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: string, path: string, body?: unknown, tries = 5): Promise<{ http: number; json: Record<string, unknown> }> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (r && r.status !== 429 && r.status < 500) return { http: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
    await wait(20_000 * (i + 1));
  }
  return { http: 0, json: { error: "gave up after retries" } };
}

type Mon = { id: string; name: string; status: string; schedule: { cron: string }; estimatedCreditsPerMonth: number; lastRunAt: string | null; nextRunAt: string | null };
async function monitors(): Promise<Mon[]> {
  return ((await api("GET", "monitor")).json.data as Mon[]) ?? [];
}

/** Pause every active monitor and confirm on Firecrawl's servers (re-read each one). */
async function pauseAllVerified() {
  const out: { id: string; name: string; before: string; after: string }[] = [];
  for (const m of await monitors()) {
    let after = m.status;
    if (m.status === "active") {
      await api("PATCH", `monitor/${m.id}`, { status: "paused" });
      await wait(16_000);
      for (let i = 0; i < 3; i++) {
        after = String(((await api("GET", `monitor/${m.id}`)).json.data as Mon | undefined)?.status ?? "unknown");
        if (after === "paused") break;
        await api("PATCH", `monitor/${m.id}`, { status: "paused" });
        await wait(20_000);
      }
    }
    out.push({ id: m.id, name: m.name, before: m.status, after });
  }
  return out;
}

function localJobs() {
  const dir = `${DATA_ROOT}/intel`;
  const working: string[] = [];
  for (const n of ["verify", "hunter", "contradict", "analogue", "contract"]) {
    try {
      const f = JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
      if (f.record?.phase === "working") working.push(`${n}: ${f.record.sparkJobIds?.[0] ?? "?"}`);
    } catch { /* none */ }
  }
  return working;
}

async function status() {
  const m = readMode();
  const usage = (await api("GET", "team/credit-usage")).json.data as { remainingCredits?: number; billingPeriodEnd?: string } | undefined;
  const mons = await monitors();
  mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
  writeFileSync(`${DATA_ROOT}/research/remote-monitors.json`, JSON.stringify({ checkedAt: new Date().toISOString(), monitors: mons.map((x) => ({ id: x.id, name: x.name, status: x.status, cron: x.schedule.cron })) }, null, 1));
  return {
    mode: m,
    remoteMonitors: mons.map((x) => ({ id: x.id, name: x.name, status: x.status, cron: x.schedule.cron, estPerMonth: x.estimatedCreditsPerMonth, nextRunAt: x.nextRunAt })),
    activeRemoteMonitors: mons.filter((x) => x.status === "active").length,
    outstandingAsyncJobs: localJobs(),
    creditsThisMonthLocalLedger: creditsThisMonth(),
    remainingCredits: usage?.remainingCredits ?? null,
    billingPeriodEnd: usage?.billingPeriodEnd ?? null,
    localSchedulers: m.mode === "RESEARCH_PAPER" ? `legacy brief ${m.approvedJobs.includes("legacy_spark_brief") ? "ON" : "off"}, clerks ${m.approvedJobs.includes("intel_clerks") ? "ON" : "off"}` : "legacy brief off, clerks off (gated in the running dev server on every tick)",
  };
}

const [cmd, arg, ...rest] = process.argv.slice(2);
if (!KEY) console.error("FIRECRAWL_API_KEY not available: remote monitors cannot be checked");
if (cmd === "set") {
  const mode = arg as Mode;
  if (!MODES.includes(mode) || mode === "LIVE_TRADING") throw new Error(`mode must be one of FULL_STANDBY, MARKET_DATA_ONLY, RESEARCH_PAPER`);
  const i = rest.indexOf("--approve");
  const approve = i >= 0 ? (rest[i + 1] ?? "").split(",").filter(Boolean) : [];
  const row = writeMode(mode, approve, `operator CLI ${new Date().toISOString()}`);
  console.log("mode written:", row);
  if (mode !== "RESEARCH_PAPER" || !approve.some((a) => a.endsWith("_monitors"))) console.log("remote monitors:", JSON.stringify(await pauseAllVerified(), null, 1));
  console.log(JSON.stringify(await status(), null, 1));
} else if (cmd === "resume") {
  const m = readMode();
  if (m.mode !== "RESEARCH_PAPER" || !m.approvedJobs.some((a) => a.endsWith("_monitors"))) throw new Error("resume needs RESEARCH_PAPER with grid_monitors or calendar_monitors approved");
  const r = await api("PATCH", `monitor/${arg}`, { status: "active" });
  console.log("resume", arg, r.http);
} else {
  console.log(JSON.stringify(await status(), null, 1));
  console.log("jobs that can be approved:", SPEND_JOBS.join(", "));
}

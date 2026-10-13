/**
 * Real end-to-end Intel Grid proof (research only, no orders):
 * official source (Alexandria Fed press releases + Firecrawl scrape) → statement diff → Alexandria BLS CPI data →
 * Spark 2 catalyst investigation (async job) → agent run with exchange.requireApproval (stops before paid calls) →
 * link to an EXISTING archived MiroFish run (no new simulation) → evidence store → features → dashboard file.
 * Paid Alexandria calls: at most 2 here (cap 3 total, each ≤ 50 credits). Every call is logged with credits.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fc, roundSpent } from "../../src/lib/grid/fc.server";
import { readExecution, paidCallRefusal, agentExchangeBody, type Approval } from "../../src/lib/grid/alexandria";
import { diffStatements } from "../../src/lib/grid/statement-diff";
import { sparkBody, validateReport, TEMPLATE_VERSION } from "../../src/lib/grid/spark-templates";
import { storeEvidence, decideFollowUp } from "../../src/lib/grid/evidence";
import { computeFeatures } from "../../src/lib/grid/features";
import { DATA_ROOT } from "../../src/lib/data-root";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const approval: Approval = { approvedBy: "Sameer via parent task (≤3 paid calls, each <50 credits)", reason: "E2E proof", maxCredits: 50, at: new Date().toISOString() };
const log: Record<string, unknown> = { at: new Date().toISOString(), template: TEMPLATE_VERSION };
let paid = 0;

async function alex(provider: string, capability: string, options: Record<string, unknown>, price: number) {
  const refusal = paidCallRefusal({ id: `${provider}/${capability}`, provider, capability, creditsCost: price }, approval, paid);
  if (refusal) return { ok: false, error: refusal, data: null, credits: 0, status: "REFUSED" };
  paid++;
  const r = await fc("POST", "scrape", "alexandria", { alexandria: [{ provider, capability, options }] }, { paid: true });
  const x = readExecution(r.json);
  return { ...x, http: r.http, credits: r.credits || x.credits, error: x.error || r.error };
}

// 1. Official source via Alexandria (Fed press releases, Monetary Policy)
const fed = await alex("federalreserve-gov", "central-bank-communications/press_releases", { type: "Monetary Policy", limit: 6, from: "2026-06-01" }, 5);
log.alexandriaFed = { ok: fed.ok, credits: fed.credits, error: fed.error };
const fedText = JSON.stringify(fed.data ?? "");
// Only real FOMC statements (minutes and discount-rate notes are different documents and would make a meaningless diff).
const urls = [...new Set([...fedText.matchAll(/"title":"Federal Reserve issues FOMC statement"[^}]{0,300}?(https?:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/monetary\d{8}a\.htm)/g)].map((m) => m[1]))].sort().reverse();
log.fomcStatementUrls = urls.slice(0, 2);
writeFileSync(`${DATA_ROOT}/research/e2e-fed-raw.json`, fedText.slice(0, 20000));
await wait(7000);

// 2. Scrape the two latest FOMC statements and diff them
let diff = null as ReturnType<typeof diffStatements> | null;
if (urls.length >= 2) {
  const [a, b] = [urls[1], urls[0]];
  const ra = await fc("POST", "scrape", "scrape", { url: a, formats: ["markdown"], onlyMainContent: true }, { paid: true });
  await wait(7000);
  const rb = await fc("POST", "scrape", "scrape", { url: b, formats: ["markdown"], onlyMainContent: true }, { paid: true });
  const ma = String((ra.json.data as { markdown?: string })?.markdown ?? "");
  const mb = String((rb.json.data as { markdown?: string })?.markdown ?? "");
  if (ma && mb) {
    diff = diffStatements(ma, mb);
    const s = storeEvidence({ kind: "statement_diff", sourceUrl: b, title: `FOMC statement diff ${a.slice(-14, -5)} → ${b.slice(-14, -5)}`, publishedAt: null, detectedAt: new Date().toISOString(), jobIds: {}, related: [a], summary: `${diff.changes.length} sentence changes (${Math.round(diff.changedShare * 100)}%)`, payload: { changes: diff.changes.slice(0, 20) }, body: `${diff.beforeHash}|${diff.afterHash}` });
    log.diff = { before: a, after: b, changes: diff.changes.length, changedShare: diff.changedShare, evidenceId: s.evidence.id, sample: diff.changes.slice(0, 3) };
  } else log.diff = { error: `${ra.error || "empty"} / ${rb.error || "empty"}` };
} else log.diff = { error: "fewer than 2 FOMC statement URLs from Alexandria", fedError: fed.error };
await wait(7000);

// 3. Alexandria BLS CPI (official data, 5 credits)
const cpi = await alex("bls-gov", "economic-statistics/bls_cpi", { category: "all_items", area_code: "0000", seasonally_adjusted: true, start_year: 2026, end_year: 2026 }, 5);
log.alexandriaCpi = { ok: cpi.ok, credits: cpi.credits, error: cpi.error, sample: JSON.stringify(cpi.data ?? "").slice(0, 400) };
if (cpi.ok) storeEvidence({ kind: "alexandria_data", sourceUrl: "https://www.bls.gov/cpi/", title: "BLS CPI-U all items SA 2026 (Alexandria bls-gov)", publishedAt: null, detectedAt: new Date().toISOString(), jobIds: {}, related: [], summary: "official CPI index levels", payload: cpi.data, body: JSON.stringify(cpi.data) });
await wait(7000);

// 4. Spark 2 investigation (async job, medium tier)
const body = sparkBody({ event: "US CPI release for September 2026", officialUrls: ["https://www.bls.gov/schedule/news_release/cpi.htm", "https://www.bls.gov/news.release/cpi.nr0.htm", "https://www.bls.gov/cpi/"], scheduledAt: "2026-10-14T12:30:00Z", assets: ["BTC", "ETH", "SOL", "XRP", "gold"] }, "medium");
const started = await fc("POST", "agent", "agent", body, { paid: true });
const jobId = typeof started.json.id === "string" ? started.json.id : null;
let job: Record<string, unknown> = {};
if (jobId) {
  for (let i = 0; i < 50; i++) {
    await wait(10_000);
    const r = await fc("GET", `agent/${jobId}`, "agent");
    job = r.json;
    if (job.status === "completed" || job.status === "failed") break;
  }
}
const v = validateReport(job.data);
log.spark = { jobId, status: job.status ?? started.error, creditsUsed: job.creditsUsed ?? null, valid: v.ok, errors: v.ok ? [] : v.errors };
let sparkEv = null;
if (jobId && job.status === "completed") {
  const s = storeEvidence({ kind: "spark_report", sourceUrl: "https://www.bls.gov/schedule/news_release/cpi.htm", title: "Spark 2: US CPI (Sep 2026) catalyst investigation", publishedAt: null, detectedAt: new Date().toISOString(), jobIds: { sparkJobId: jobId }, related: [], summary: v.ok ? String(v.report.what_changed).slice(0, 400) : `INVALID: ${(v as { errors: string[] }).errors.join("; ")}`, payload: { valid: v.ok, report: job.data }, body: JSON.stringify(job.data) });
  sparkEv = s.evidence;
  log.spark = { ...(log.spark as object), evidenceId: s.evidence.id, followUp: decideFollowUp(s.evidence) };
}
await wait(7000);

// 5. Agent with Alexandria exchange + requireApproval: must stop with pendingApproval before any paid provider call
const ex = await fc("POST", "agent", "agent", agentExchangeBody("What was the most recent US CPI-U all items 12-month change, per BLS? Use official data providers.", ["bls-gov"], 40), { paid: true });
const exId = typeof ex.json.id === "string" ? ex.json.id : null;
let exJob: Record<string, unknown> = {};
if (exId) for (let i = 0; i < 30; i++) {
  await wait(10_000);
  exJob = (await fc("GET", `agent/${exId}`, "agent")).json;
  if (["completed", "failed", "requires_action", "cancelled"].includes(String(exJob.status)) || exJob.pendingApproval) break;
}
log.exchangeApproval = { jobId: exId, status: exJob.status ?? ex.error, creditsUsed: exJob.creditsUsed ?? null, pendingApproval: exJob.pendingApproval ?? null, exchange: exJob.exchange ?? null, approved: false };

// 6. MiroFish: reuse the existing archived CPI run (no new simulation; budget belongs to the other worker)
const job0 = JSON.parse(readFileSync(`${DATA_ROOT}/research/jobs/rj-mv0y26fq-156cd2.json`, "utf8"));
const mf = storeEvidence({ kind: "mirofish_link", sourceUrl: null, title: "MiroFish archived CPI baseline (reused, simulated, not a prediction)", publishedAt: null, detectedAt: new Date().toISOString(), jobIds: { mirofishJob: job0.id, reportId: job0.ids.reportId, simulationId: job0.ids.simulationId, graphId: job0.ids.graphId }, related: sparkEv ? [sparkEv.id] : [], summary: "SIMULATED scenario context; same catalyst id cpi-2026-10-14 → no duplicate job", payload: { catalyst: job0.spec?.catalyst?.id }, body: job0.id });
log.mirofish = { reused: job0.id, ids: job0.ids, evidenceId: mf.evidence.id, newSimulation: false };

// 7. Features (weight 0) and dashboard file
const features = computeFeatures({ diffChangedShare: diff?.changedShare ?? null, diffSource: urls[0] ?? null, eventsNext24h: null, scenarioLeans: undefined, mirofishReportId: job0.ids.reportId });
log.features = features.map((f) => `${f.name}:${f.status}`);
log.roundCreditsLogged = roundSpent();
mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
writeFileSync(`${DATA_ROOT}/research/grid-e2e.json`, JSON.stringify({ ...log, features }, null, 1));
console.log(JSON.stringify(log, null, 1));

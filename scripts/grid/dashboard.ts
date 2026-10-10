/** Build the Intel Grid dashboard file from local evidence (0 credits). `bun scripts/grid/dashboard.ts` */
import { readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { readEvidence } from "../../src/lib/grid/evidence";
import { budgetNow } from "../../src/lib/intel/budget.server";
import { readMode } from "../../src/lib/ops/operating-mode";
import { currentRound, roundSpent } from "../../src/lib/grid/fc.server";

const R = `${DATA_ROOT}/research`;
const j = (f: string) => { try { return JSON.parse(readFileSync(`${R}/${f}`, "utf8")); } catch { return null; } };
const calls = (() => { try { return readFileSync(`${R}/grid-calls.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })();
const byCat: Record<string, number> = {};
for (const c of calls) byCat[c.category] = (byCat[c.category] ?? 0) + (c.credits || 0);
const evidence = readEvidence();
const monitors = j("grid-monitors.json");
const e2e = j("grid-e2e.json");
const pilot = j("grid-pilot-summary.json");
const latencies = evidence.map((e) => (e.publishedAt ? (Date.parse(e.detectedAt) - Date.parse(e.publishedAt)) / 60000 : null)).filter((x): x is number => x !== null && x >= 0);
const out = {
  generatedAt: new Date().toISOString(),
  label: "RESEARCH ONLY. Nothing here can place, amend or cancel orders or change a calibrated probability.",
  monitors: monitors?.monitors ?? [], pilot: monitors?.pilot ?? null, pilotSummary: pilot,
  lastRefresh: monitors?.syncedAt ?? monitors?.at ?? null,
  materialChanges: evidence.filter((e) => e.kind === "monitor_change" || e.kind === "statement_diff").slice(-20),
  spark: evidence.filter((e) => e.kind === "spark_report").slice(-10),
  alexandria: { providers: j("alexandria-providers.json"), data: evidence.filter((e) => e.kind === "alexandria_data").slice(-10) },
  mirofish: evidence.filter((e) => e.kind === "mirofish_link").slice(-10),
  errors: calls.filter((c) => !c.ok).slice(-15),
  stale: evidence.filter((e) => e.stale || e.injectionFlag).slice(-10),
  creditsByCategory: byCat, budget: budgetNow(),
  medianPublicationToDetectionMin: latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null,
  features: e2e?.features ?? [], featureEvaluation: "NOT_EVALUATED: no feature has weight until it shows out-of-sample value against the validated Kalshi model",
  modelPerformanceEffect: "none (all research features weight 0)",
  operatingMode: readMode(), round: currentRound(), roundSpent: roundSpent(),
  remoteMonitorsStatus: j("remote-monitors.json"),
  trace: j("grid-trace.json"), roi: j("grid-roi.json"),
  consumedByShadowEval: "none: no research output is read by the shadow evaluation yet (all feature weights 0)",
};
writeFileSync(`${R}/grid-dashboard.json`, JSON.stringify(out, null, 1));
console.log("wrote grid-dashboard.json:", evidence.length, "evidence items,", out.monitors.length, "monitors");

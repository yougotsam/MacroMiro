/**
 * Report-only replay + live-shadow analysis (no orders, no keys, no switches; public GETs only for fee multipliers).
 *   bun scripts/desk-analyze.ts [--hist <dir>] [--live <dir>] [--out file.json] [--offline]
 * A. HISTORICAL — the desk ledger (decisions.jsonl + outcomes.jsonl), per model version, purged chronological split.
 * B. LIVE SHADOW — the read-only collector (observations-*.jsonl + outcomes-*.jsonl + indicators-*.jsonl).
 * Each: model vs Kalshi mid (Brier, skill, cluster-bootstrap CI) by market and expiry bucket, and simulated net P/L at
 * executable prices after the actual fee and within displayed depth, by strategy × market × bucket, clustered by window.
 */
import { createReadStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { approvalRuleOos, calibrationTables, gateTaker, groupBy, pnlTables, purgedSplit, sniperTaker, type Trade } from "../src/lib/desk/analysis";
import { eventOf, joinObservations, type LedgerRow, type Obs, type OutcomeRow } from "../src/lib/desk/calibration";
import { eventFee } from "../src/lib/desk/kalshi-read";

const args = process.argv.slice(2);
const opt = (k: string, d: string | null) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
const HIST = opt("--hist", "/workspace/data/desk")!;
const LIVE = opt("--live", "/workspace/data/desk-observe")!;
const OUT = opt("--out", null);
const OFFLINE = args.includes("--offline");

async function readJsonl<T>(file: string, keep: (l: string) => boolean = () => true): Promise<T[]> {
  const out: T[] = [];
  if (!existsSync(file)) return out;
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim() || !keep(l)) continue;
    try { out.push(JSON.parse(l) as T); } catch { /* torn line */ }
  }
  return out;
}
const readAll = async <T>(dir: string, prefix: string, keep?: (l: string) => boolean) => {
  if (!existsSync(dir)) return [] as T[];
  const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl")).sort();
  return (await Promise.all(files.map((f) => readJsonl<T>(`${dir}/${f}`, keep)))).flat();
};

const fees = new Map<string, number>();
async function loadFees(outcomes: OutcomeRow[]) {
  if (OFFLINE) return;
  for (const ev of [...new Set(outcomes.map((o) => eventOf(o.ticker)))].sort()) {
    if (fees.has(ev)) continue;
    try { fees.set(ev, (await eventFee(ev.split("-")[0], ev)).multiplier); } catch { /* fee unknown → not booked */ }
    await new Promise((r) => setTimeout(r, 60));
  }
}

function section(obs: Obs[], trades: Trade[], extra: Record<string, unknown>) {
  return { observations: obs.length, contracts: new Set(obs.map((o) => o.ticker)).size, windows: new Set(obs.map((o) => o.closeMs)).size, calibration: calibrationTables(obs), pnl: pnlTables(trades), ...extra };
}

// ---------- A. historical ----------
const hDec = await readJsonl<LedgerRow>(`${HIST}/decisions.jsonl`, (l) => l.includes('"quotes":{'));
const hOut = await readJsonl<OutcomeRow>(`${HIST}/outcomes.jsonl`);
await loadFees(hOut);
const historical: Record<string, unknown> = {};
for (const [model, rows] of groupBy(hDec, (d) => d.model)) {
  const obs = joinObservations(rows, hOut, undefined, fees);
  const { train, test } = purgedSplit(obs);
  const gate = gateTaker(test);
  const d1 = (xs: Obs[]) => xs.map((o) => ({ ...o, yesBidSize: o.yesBidSize ?? 1, noBidSize: o.noBidSize ?? 1 }));
  const gateDepth1 = gateTaker(d1(test));
  const apprDepth1 = approvalRuleOos(train, d1(test));
  const appr = approvalRuleOos(train, test);
  historical[model] = {
    split: { train: train.length, test: test.length, note: "all tables below are the TEST (out-of-sample) part" },
    ...section(test, [...gate.trades, ...appr.trades], {
      skipped: { settlement_gate_taker: gate.skipped, approval_rule_oos: appr.skipped },
      approvalCalibrator: appr.calibrator,
      sensitivity_depth1_NOT_EXECUTABLE_EVIDENCE: { note: "ledger has no depth; assumes 1 contract was available — hypothetical", pnl: pnlTables([...gateDepth1.trades.map((t) => ({ ...t, strategy: "gate_taker_assumed_depth1" })), ...apprDepth1.trades.map((t) => ({ ...t, strategy: "approval_rule_oos_assumed_depth1" }))]), approvalSkipped: apprDepth1.skipped },
      sniper_confluence_research: "unavailable — no indicator snapshots exist for the historical period (tape/CVD cannot be reconstructed)",
    }),
  };
}

// ---------- B. live shadow ----------
const lRows = await readAll<LedgerRow>(LIVE, "observations-", (l) => l.includes('"quotes":{'));
const lOut = await readAll<OutcomeRow>(LIVE, "outcomes-");
await loadFees(lOut);
type Ind = { ts: string; series: string; sniper?: { long?: { eligible?: boolean }; short?: { eligible?: boolean } } };
const ind = await readAll<Ind>(LIVE, "indicators-");
const indBy = groupBy(ind.map((r) => ({ ...r, ms: Date.parse(r.ts) })).sort((a, b) => a.ms - b.ms), (r) => r.series);
const signal = (o: Obs): "long" | "short" | null => {
  const at = o.closeMs - o.tte * 1000;
  const xs = (indBy.get(o.series) ?? []).filter((r) => r.ms <= at && r.ms >= at - 120_000);
  const r = xs[xs.length - 1];
  if (!r?.sniper) return null;
  const l = !!r.sniper.long?.eligible, s = !!r.sniper.short?.eligible;
  return l && !s ? "long" : s && !l ? "short" : null;
};
const live: Record<string, unknown> = {};
for (const [model, rows] of groupBy(lRows, (d) => d.model)) {
  const obs = joinObservations(rows, lOut, undefined, fees);
  const gate = gateTaker(obs);
  const sn = sniperTaker(obs, signal);
  live[model] = section(obs, [...gate.trades, ...sn.trades], {
    rowsRecorded: rows.length,
    skipped: { settlement_gate_taker: gate.skipped, sniper_confluence_research: sn.skipped },
    approval_rule: "0 trades by construction — no approved calibrator exists for this model version; a calibrator fitted on another model version must not be reused",
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  method: "Executable prices only (displayed ask; size ≤ displayed depth; event fee multiplier; one entry per contract; ≤ $3/order). Clustered SE by 15-minute close window. Kalshi implied probability = YES mid.",
  historical: { decisions: hDec.length, outcomes: hOut.length, rowsWithDepth: hDec.filter((d) => d.depth != null).length, byModel: historical },
  liveShadow: { observationRows: lRows.length, outcomes: lOut.length, indicatorRows: ind.length, byModel: live },
  feesFetched: fees.size,
};
const txt = JSON.stringify(report, null, 2);
if (OUT) writeFileSync(OUT, txt);
console.log(txt);

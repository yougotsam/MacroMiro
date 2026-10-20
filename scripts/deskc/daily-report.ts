/**
 * Owner report. Read-only. Does not send an order and does not raise a cap.
 * Run: bun scripts/deskc/daily-report.ts
 */
import { readFileSync } from "node:fs";
import { FAST_LANE_MIN, FAST_LANE_Z, judgeSetup } from "../../src/lib/deskc/promotion";
import { brier, brierBeatsPrice } from "../../src/lib/deskc/scorecard";
import { lastPerTicker, scoreableDecisions, type RawDecision } from "../../src/lib/deskc/retro";
import { selectResidual, type AnchorRow } from "../../src/lib/deskc/anchor";
import { seriesWindows } from "../../src/lib/deskc/exclusion";

function lines(path: string): unknown[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
}

const decisions = lines("data/desk/decisions.jsonl") as RawDecision[];
const outcomes = new Map<string, "yes" | "no">();
for (const o of lines("data/desk/outcomes.jsonl") as { ticker?: string; result?: string }[]) {
  if (o.ticker && (o.result === "yes" || o.result === "no")) outcomes.set(o.ticker, o.result);
}

const reasons = new Map<string, number>();
let none = 0;
let named = 0;
let noSniper = 0;
for (const d of decisions) {
  reasons.set(d.failed_gate ?? "(none)", (reasons.get(d.failed_gate ?? "(none)") ?? 0) + 1);
  const setup = d.confluence?.long?.setup;
  if (!d.confluence) noSniper += 1;
  else if (!setup || setup === "NONE") none += 1;
  else named += 1;
}

console.log("WHY A TICKET SAT");
for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${n}  ${k}`);
console.log(`setup NONE ${none}  named ${named}  sniper never reached ${noSniper}`);
console.log("HISTORY: settlement-index prints on disk build closed 15m and 1h bars for gold, silver, oil, and FX. A 15m bar exists only when all 15 minutes printed. A short series is logged as 15m index bars N/60; gaps not filled, and it does not name a setup. Coinbase still scores crypto once 60 stored bars exist. A gap is counted and not filled.");
console.log("FLOW: a mapped product with a stale tape sits as G1_flow_stale. Gold, silver, oil, and FX log unavailable: no venue tape until a proxy clears the correlation gate and beats Tier A on Brier. A missing tape is null, not zero. The settlement price still uses the index.");
console.log("SEND GATE: dollar caps not changed. PR #9 stays unmerged. A window the scorecard has already shown losing (15 or more contracts, after-fee EV below zero) is refused. Gold's last 90 seconds is that window today. The refusal lifts itself if the window stops losing.");

const pointNames = ["structure", "liquidity", "flow", "momentum", "regime", "macro", "trigger"] as const;
const pointSum = Object.fromEntries(pointNames.map((k) => [k, { s: 0, n: 0 }])) as Record<(typeof pointNames)[number], { s: number; n: number }>;
const voteSum = { trend: { s: 0, n: 0 }, momentum: { s: 0, n: 0 }, structure: { s: 0, n: 0 }, candle: { s: 0, n: 0 }, rvol: { s: 0, n: 0 }, cvd: { s: 0, n: 0 } };
let earlyReturn = 0;
for (const d of decisions) {
  for (const side of [d.confluence?.long, d.confluence?.short]) {
    if (side?.missing?.some((m) => m === "60 complete 15m bars" || m.startsWith("15m index bars "))) earlyReturn += 1;
    const pts = side?.points;
    if (!pts) continue;
    for (const k of pointNames) {
      if (typeof pts[k] === "number") {
        pointSum[k].s += pts[k];
        pointSum[k].n += 1;
      }
    }
  }
  const votes = d.features?.group_votes;
  const trend = typeof votes?.trend === "number" ? votes.trend : typeof d.features?.trend === "number" ? d.features.trend : null;
  const momentum = typeof votes?.momentum === "number" ? votes.momentum : typeof d.features?.momentum === "number" ? d.features.momentum : null;
  if (trend != null) { voteSum.trend.s += trend; voteSum.trend.n += 1; }
  if (momentum != null) { voteSum.momentum.s += momentum; voteSum.momentum.n += 1; }
  if (typeof votes?.structure === "number") { voteSum.structure.s += votes.structure; voteSum.structure.n += 1; }
  if (typeof votes?.candle === "number") { voteSum.candle.s += votes.candle; voteSum.candle.n += 1; }
  if (typeof d.features?.flow?.rvol === "number") { voteSum.rvol.s += d.features.flow.rvol; voteSum.rvol.n += 1; }
  if (typeof d.features?.flow?.cvd === "number") { voteSum.cvd.s += d.features.flow.cvd; voteSum.cvd.n += 1; }
}
const mean = (x: { s: number; n: number }) => (x.n ? (x.s / x.n).toFixed(4) : "n/a");
console.log("GROUP MEANS (sniper points, both sides)");
for (const k of pointNames) console.log(`  ${k}  mean ${mean(pointSum[k])}  n ${pointSum[k].n}`);
console.log(`sides that stored a short-history veto: ${earlyReturn}. Older rows used "60 complete 15m bars". A blind series now names 15m index bars N/60; gaps not filled.`);
console.log(`CHART VOTES  trend ${mean(voteSum.trend)} n=${voteSum.trend.n}  momentum ${mean(voteSum.momentum)} n=${voteSum.momentum.n}  structure ${mean(voteSum.structure)} n=${voteSum.structure.n}  candle ${mean(voteSum.candle)} n=${voteSum.candle.n}  rvol ${mean(voteSum.rvol)} n=${voteSum.rvol.n}  cvd ${mean(voteSum.cvd)} n=${voteSum.cvd.n}`);

const joined = scoreableDecisions(decisions, outcomes);
const one = lastPerTicker(decisions, outcomes);
console.log(`\nRECOVERY  decisions ${decisions.length}  with a settlement and a price ${joined.rows.length}  one row per contract ${one.length}`);
console.log(`dropped ${JSON.stringify(joined.dropped)}`);
console.log("Closed contracts in this log already have a settlement. The old 182 was one row per contract, not 23,000 lost results.");

const scored = one.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
const cmp = brierBeatsPrice(scored, FAST_LANE_Z);
const verdict = judgeSetup(one, { minDecisions: FAST_LANE_MIN, z: FAST_LANE_Z, windowSize: 50, embargoMs: 0 });
console.log(`\nCHALLENGER  settlement model Brier ${brier(scored).toFixed(4)}  price Brier ${brier(scored.map((r) => ({ p: r.price, y: r.y }))).toFixed(4)}  beats at 80% ${cmp.better}`);
console.log(`fast lane ${verdict.state}  ${verdict.why}`);

const anchorRows: AnchorRow[] = one.map((r) => {
  const src = decisions.find((d) => d.ticker === r.featureHash && typeof d.features?.trend === "number");
  const features: Record<string, number> = {};
  if (typeof src?.features?.trend === "number") features.trend = src.features.trend;
  if (typeof src?.features?.momentum === "number") features.momentum = src.features.momentum;
  const votes = src?.features?.group_votes;
  if (typeof votes?.structure === "number") features.structure = votes.structure;
  if (typeof votes?.candle === "number") features.candle = votes.candle;
  const flow = src?.features?.flow;
  if (typeof flow?.rvol === "number") features.rvol = flow.rvol;
  if (typeof flow?.cvd === "number") features.cvd = flow.cvd;
  return { expiryMs: r.expiryMs, y: r.settledYes as 0 | 1, price: r.yesPrice, features };
});
const fit = selectResidual(anchorRows, 40);
console.log(`\nPRICE ANCHOR  kept [${fit.kept.join(", ") || "none"}]  model Brier ${fit.modelBrier.toFixed(4)}  price Brier ${fit.priceBrier.toFixed(4)}  beats price ${fit.beatsPrice}`);
for (const r of fit.rejected) console.log(`  rejected ${r.name}  oos ${Number.isFinite(r.oosBrier) ? r.oosBrier.toFixed(4) : "n/a"}`);
console.log(fit.beatsPrice ? "eligible setups may be considered" : "eligible setups: 0. Distance to the cap release: the anchored model has not beaten the price.");
const hasNew = anchorRows.some((r) => "structure" in r.features || "rvol" in r.features);
console.log(hasNew ? "structure and flow votes were in this log" : "structure and flow are not in the historical log yet. price+structure+flow waits for the next session. Eligible setups stay 0.");

console.log("\nSERIES WINDOWS");
for (const w of seriesWindows(one)) {
  if (w.n < 10) continue;
  console.log(`  ${w.series} ${w.bucket} n=${w.n} ev=${w.ev.toFixed(4)} ${w.excluded ? "EXCLUDED" : "open"}`);
}

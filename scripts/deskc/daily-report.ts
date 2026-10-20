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
console.log("BLOCK: the live evaluator keeps 1 hour of index prints. The sniper returns score 0 until it has 60 complete 15-minute bars (15 hours). Coinbase candles are read by the observer only. They do not reach this decision. Flow, RVOL, CVD, and VWAP therefore score nothing here. The 4 chart votes do run; they are not the NONE.");
console.log("SEND GATE: not changed. A named sniper setup is allowed to open a ticket, so those bars stay off the order path.");

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
  return { expiryMs: r.expiryMs, y: r.settledYes as 0 | 1, price: r.yesPrice, features };
});
const fit = selectResidual(anchorRows, 40);
console.log(`\nPRICE ANCHOR  kept [${fit.kept.join(", ") || "none"}]  model Brier ${fit.modelBrier.toFixed(4)}  price Brier ${fit.priceBrier.toFixed(4)}  beats price ${fit.beatsPrice}`);
for (const r of fit.rejected) console.log(`  rejected ${r.name}  oos ${Number.isFinite(r.oosBrier) ? r.oosBrier.toFixed(4) : "n/a"}`);
console.log(fit.beatsPrice ? "eligible setups may be considered" : "eligible setups: 0. Distance to the cap release: the anchored model has not beaten the price.");

console.log("\nSERIES WINDOWS");
for (const w of seriesWindows(one)) {
  if (w.n < 10) continue;
  console.log(`  ${w.series} ${w.bucket} n=${w.n} ev=${w.ev.toFixed(4)} ${w.excluded ? "EXCLUDED" : "open"}`);
}

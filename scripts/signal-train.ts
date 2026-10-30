/**
 * Measure the pre-trade score from data. Walk-forward test first (#124 protocol), then fit the final weights.
 * Writes data/signal/model.json (weights + verdicts) and data/signal/report.md (plain summary).
 * Usage: bun scripts/signal-train.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PROTOCOL, finalModel, runProtocol, samplesFor, type Sample } from "../src/lib/signal/backtest";
import { tier1, type Release } from "../src/lib/signal/news";
import type { Bar } from "../src/lib/signal/ta";

const ASSETS: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", GOLD: "PAXG-USD" };
const cal = JSON.parse(readFileSync("data/macro-calendar.json", "utf8")) as { events: Release[] };
const releases = tier1(cal.events);

const samples: Sample[] = [];
for (const [asset, product] of Object.entries(ASSETS)) {
  const bars = readFileSync(`data/signal/bars/${product}-15m.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Bar);
  const s = samplesFor(asset, bars, releases);
  console.log(asset, bars.length, "bars →", s.length, "samples");
  samples.push(...s);
}
const t0 = performance.now();
const res = runProtocol(samples);
console.log(`walk-forward ${res.folds} weeks, ${res.oosRows} out-of-sample rows, ${((performance.now() - t0) / 1000).toFixed(1)}s`);
const model = finalModel(samples, `signal-v1-${new Date().toISOString().slice(0, 10)}`);
const lastCut = res.cuts[res.cuts.length - 1] ?? { pred: PROTOCOL.edgeCuts.at(-1), perp: PROTOCOL.edgeCuts.at(-1) };
const out = {
  builtAt: new Date().toISOString(),
  protocol: PROTOCOL,
  model,
  entryCut: { prediction: lastCut.pred, perp: lastCut.perp },
  verdict: { prediction: res.prediction, perp: res.perp },
  reliability: res.reliability,
  assumptions: "Prediction fills assumed at 51¢ taker with quadratic fee; perps 0.10% round trip; label = next 15m close vs this close; gold uses PAXG-USD as its price.",
};
writeFileSync("data/signal/model.json", JSON.stringify(out, null, 1));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const line = (r: typeof res.prediction) => `| ${r.product} | ${r.trades} | ${pct(r.winRate)} | ${(r.meanPnl * 100).toFixed(2)}¢ | ${(r.ci95[0] * 100).toFixed(2)}¢ … ${(r.ci95[1] * 100).toFixed(2)}¢ | ${r.foldsPositive}/${r.folds} | ${r.kept ? "KEPT" : "not kept"} |`;
const weights = model.features.map((f, k) => ({ f, w: model.weights[k] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
writeFileSync("data/signal/report.md", [
  `# Pre-trade score: measured report (${out.builtAt})`,
  "",
  `${samples.length} bars across BTC, ETH, SOL, XRP and gold (PAXG). ${res.folds} weekly walk-forward tests, ${res.oosRows} scored out of sample.`,
  `Brier: model ${res.prediction.brierModel.toFixed(5)} vs coin-flip ${res.prediction.brierBase.toFixed(5)}.`,
  "",
  "| Product | Trades | Win rate | Avg per contract/unit after fees | 95% range | Winning weeks | Verdict |",
  "|---|---|---|---|---|---|---|",
  line(res.prediction),
  line(res.perp),
  "",
  `Prediction: ${res.prediction.why}`,
  "",
  `Perps: ${res.perp.why}`,
  "",
  "## Weights (log-odds per unit, measured)",
  "",
  ...weights.map((x) => `- ${x.f}: ${x.w.toFixed(4)}`),
  "",
  `Assumptions: ${out.assumptions}`,
].join("\n") + "\n");
console.log(JSON.stringify({ prediction: { ...res.prediction, byAsset: undefined }, perp: { ...res.perp, byAsset: undefined } }, null, 1));
console.log(weights.slice(0, 12));

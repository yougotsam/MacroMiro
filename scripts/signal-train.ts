/**
 * Measure the pre-trade score from data. Walk-forward test first (#124 protocol), then fit the final weights.
 * Inputs: 15m bars (signal-fetch-bars / signal-fetch-extra), the official release calendar
 * (data/signal/news/calendar.json), GDELT headline tone (data/signal/news/tone-*.jsonl), the perps rules backtest
 * (data/signal/perps.json from scripts/signal-perps.ts).
 * Writes data/signal/model.json (weights + verdicts + priors) and data/signal/report.md (plain summary).
 * Usage: bun scripts/signal-train.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PROTOCOL, finalModel, perpReport, runProtocol, samplesFor, type Sample } from "../src/lib/signal/backtest";
import { readTone, type Asset } from "../src/lib/signal/news";
import { FEATURES } from "../src/lib/signal/features";
import { MIROFISH_PRIOR_WEIGHT, MIROFISH_PRIOR_WHY } from "../src/lib/signal/config";
import type { Bar } from "../src/lib/signal/ta";

const ASSETS: Record<Asset, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", GOLD: "XAU-USD" };
const cal = JSON.parse(readFileSync("data/signal/news/calendar.json", "utf8")) as { events: { kind: string; when: string }[] };
const releases = cal.events.map((e) => Date.parse(e.when)).filter(Number.isFinite).sort((a, b) => a - b);
const toneMacro = readTone("data/signal", "MACRO");

const samples: Sample[] = [];
for (const [asset, product] of Object.entries(ASSETS) as [Asset, string][]) {
  const bars = readFileSync(`data/signal/bars/${product}-15m.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Bar);
  const s = samplesFor(asset, bars, releases, { toneAsset: readTone("data/signal", asset), toneMacro });
  console.log(asset, bars.length, "bars →", s.length, "samples");
  samples.push(...s);
}
const t0 = performance.now();
const res = runProtocol(samples);
console.log(`walk-forward ${res.folds} weeks, ${res.oosRows} out-of-sample rows, ${((performance.now() - t0) / 1000).toFixed(1)}s`);
const model = finalModel(samples, `signal-v2-${new Date().toISOString().slice(0, 10)}`);

// Live-only inputs have no history, so the fit leaves them at 0. Give them their documented priors.
const idx = (f: string) => FEATURES.indexOf(f as (typeof FEATURES)[number]);
const priors: Record<string, { weight: number; why: string }> = {
  mirofish: { weight: MIROFISH_PRIOR_WEIGHT, why: MIROFISH_PRIOR_WHY },
  news_spark: { weight: model.weights[idx("tone_asset")], why: "the Spark card is a live read of the same headlines; it borrows the measured tone_asset weight" },
};
for (const [f, p] of Object.entries(priors)) model.weights[idx(f)] = p.weight;

// Release window: out-of-sample prediction trades by minutes from the nearest release
const BUCKETS: [number, number][] = [[-120, -60], [-60, -30], [-30, -15], [-15, 0], [0, 15], [15, 30], [30, 60], [60, 120], [120, 240]];
const near = (t: number) => { let best = Infinity; for (const r of releases) { const d = (t - r) / 60_000; if (Math.abs(d) < Math.abs(best)) best = d; } return best; };
const win = BUCKETS.map(([a, b]) => {
  const tr = res.trades.filter((x) => { const m = near(x.t - 15 * 60_000); return m >= a && m < b; });
  return { from: a, to: b, n: tr.length, mean: tr.length ? tr.reduce((s, x) => s + x.pnl, 0) / tr.length : 0 };
});
const away = res.trades.filter((x) => Math.abs(near(x.t - 15 * 60_000)) >= 240);
const awayMean = away.length ? away.reduce((s, x) => s + x.pnl, 0) / away.length : 0;

const perpsRows = existsSync("data/signal/perps.json") ? (JSON.parse(readFileSync("data/signal/perps.json", "utf8")) as { variant: string; asset: string; trades: number; winRate: number; avgR: number; returnPct: number; halted: boolean }[]) : [];
const live = perpsRows.filter((r) => r.variant === "Sameer setup, 8h hold (live plan)");
const perp = perpReport(live, live.length
  ? `Sameer's rules, 180 days: ${live.map((r) => `${r.asset} ${r.returnPct.toFixed(1)}%`).join(", ")} after fees and funding; not kept (needs ≥200 trades and a positive result with 95% confidence)`
  : "no perps rules backtest on disk (run bun scripts/signal-perps.ts)");

const lastCut = res.cuts[res.cuts.length - 1] ?? { pred: PROTOCOL.edgeCuts.at(-1) };
const out = {
  builtAt: new Date().toISOString(),
  protocol: PROTOCOL,
  model,
  priors,
  entryCut: { prediction: lastCut.pred, perp: 0 },
  verdict: { prediction: res.prediction, perp },
  releaseWindow: { buckets: win, awayMean, awayN: away.length },
  reliability: res.reliability,
  assumptions: "Prediction fills assumed at 51¢ taker with quadratic fee (checked by scripts/fills-vs-51.ts); label = next 15m close vs this close; gold = OKX XAU-USDT-SWAP (spot-gold perp). Perps verdict comes from the rules backtest, not this fit. News: official BLS/Fed release times and GDELT headline tone, both public and free.",
};
writeFileSync("data/signal/model.json", JSON.stringify(out, null, 1));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const r = res.prediction;
const weights = model.features.map((f, k) => ({ f, w: model.weights[k] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
writeFileSync("data/signal/report.md", [
  `# Pre-trade score: measured report (${out.builtAt})`,
  "",
  `${samples.length} bars across BTC, ETH, SOL, XRP and gold. ${res.folds} weekly walk-forward tests, ${res.oosRows} scored out of sample.`,
  `Brier: model ${r.brierModel.toFixed(5)} vs coin-flip ${r.brierBase.toFixed(5)}.`,
  "",
  "## 15-minute prediction contracts",
  "",
  "| Trades | Win rate | Avg per contract after fees | 95% range | Winning weeks | Verdict |",
  "|---|---|---|---|---|---|",
  `| ${r.trades} | ${pct(r.winRate)} | ${(r.meanPnl * 100).toFixed(2)}¢ | ${(r.ci95[0] * 100).toFixed(2)}¢ … ${(r.ci95[1] * 100).toFixed(2)}¢ | ${r.foldsPositive}/${r.folds} | ${r.kept ? "KEPT" : "not kept"} |`,
  "",
  r.why,
  "",
  "## Perpetuals (Sameer's rules, see perps-report.md)",
  "",
  perp.why,
  "",
  "## Release window (prediction trades, minutes from the nearest CPI / NFP / PPI / FOMC)",
  "",
  "| Minutes | Trades | Avg per contract |",
  "|---|---|---|",
  ...win.map((w) => `| ${w.from} to ${w.to} | ${w.n} | ${(w.mean * 100).toFixed(2)}¢ |`),
  `| 4h+ away | ${away.length} | ${(awayMean * 100).toFixed(2)}¢ |`,
  "",
  "## Weights (log-odds per unit; measured unless listed under priors)",
  "",
  ...weights.map((x) => `- ${x.f}: ${x.w.toFixed(4)}${priors[x.f] ? " (prior)" : ""}`),
  "",
  "Priors:",
  ...Object.entries(priors).map(([f, p]) => `- ${f} = ${p.weight.toFixed(4)}: ${p.why}`),
  "",
  `Assumptions: ${out.assumptions}`,
].join("\n") + "\n");
console.log(JSON.stringify({ prediction: { ...r, byAsset: undefined }, releaseWindow: out.releaseWindow }, null, 1));
console.log(weights.slice(0, 14));

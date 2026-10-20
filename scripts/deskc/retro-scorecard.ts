/**
 * Score the desk's existing decision log. Read-only. Prints the fast-lane table.
 * Run: bun scripts/deskc/retro-scorecard.ts
 */
import { readFileSync } from "node:fs";
import { FAST_LANE_MIN, FAST_LANE_Z, judgeSetup } from "../../src/lib/deskc/promotion";
import { brier, brierBeatsPrice, tteBucket } from "../../src/lib/deskc/scorecard";
import { lastPerTicker, type RawDecision } from "../../src/lib/deskc/retro";

function lines(path: string): unknown[] {
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
}

const decisions = lines("data/desk/decisions.jsonl") as RawDecision[];
const outcomes = new Map<string, "yes" | "no">();
for (const o of lines("data/desk/outcomes.jsonl") as { ticker?: string; result?: string }[]) {
  if (o.ticker && (o.result === "yes" || o.result === "no")) outcomes.set(o.ticker, o.result);
}
const rows = lastPerTicker(decisions, outcomes);
const scored = rows.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
const cmp = brierBeatsPrice(scored, FAST_LANE_Z);
const ev = rows.reduce((a, r) => a + (r.pnlAfterFees ?? 0), 0) / (rows.length || 1);
const verdict = judgeSetup(rows, { minDecisions: FAST_LANE_MIN, z: FAST_LANE_Z, windowSize: 50, embargoMs: 0 });

console.log(`decisions ${decisions.length}  settled tickers ${rows.length}`);
console.log(`model Brier ${brier(scored).toFixed(4)}  price Brier ${brier(scored.map((r) => ({ p: r.price, y: r.y }))).toFixed(4)}`);
console.log(`beats price at 80% ${cmp.better}  mean error gap ${cmp.mean.toFixed(5)}  after-fee EV ${ev.toFixed(4)}`);
console.log(`fast lane ${verdict.state}  ${verdict.why}  remain ${Math.max(0, FAST_LANE_MIN - verdict.n)}`);

const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const k = `${r.setup}|${r.series}|${tteBucket(r.tteSec)}`;
  const list = groups.get(k) ?? [];
  list.push(r);
  groups.set(k, list);
}
for (const [k, xs] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  if (xs.length < 15) continue;
  const s = xs.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
  const g = brierBeatsPrice(s, FAST_LANE_Z);
  const gev = xs.reduce((a, r) => a + (r.pnlAfterFees ?? 0), 0) / xs.length;
  console.log(`${k} n=${xs.length} brier ${brier(s).toFixed(3)} vs ${brier(s.map((r) => ({ p: r.price, y: r.y }))).toFixed(3)} beat80=${g.better} ev=${gev.toFixed(4)} remain=${Math.max(0, FAST_LANE_MIN - xs.length)}`);
}

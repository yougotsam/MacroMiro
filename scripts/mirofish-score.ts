/**
 * Scores the finished MiroFish scenario runs against what actually happened.
 * For each done job: the scenario direction per asset (news.ts scenarioDirection) vs the real move from the
 * release time to 4 hours after, from the 15m bar files. Small sample: printed, never turned into a percent.
 * Usage: bun scripts/mirofish-score.ts   (writes data/signal/mirofish-score.json)
 */
import { writeFileSync } from "node:fs";
import { DATA_ROOT } from "../src/lib/data-root";
import { readResearchJobs, scenarioDirection, type Asset } from "../src/lib/signal/news";
import { readBars, SIGNAL_DIR } from "../src/lib/signal/store";

const ASSETS: Asset[] = ["BTC", "ETH", "SOL", "XRP", "GOLD"];
const jobs = readResearchJobs(`${DATA_ROOT}/research/jobs`).filter((j) => j.stage === "done" && j.spec?.catalyst?.when);
const rows: { scenario: string; when: string; asset: Asset; dir: number; move: number | null; hit: boolean | null }[] = [];
for (const j of jobs) {
  const when = Date.parse(j.spec!.catalyst!.when!);
  for (const a of ASSETS) {
    const dir = scenarioDirection(j.result?.extracted ?? {}, a);
    if (dir == null || dir === 0) continue;
    const b = readBars(a);
    const i0 = b.findIndex((x) => x.t >= when);
    const i1 = b.findIndex((x) => x.t >= when + 4 * 3_600_000);
    const move = i0 >= 0 && i1 > i0 ? b[i1].c / b[i0].o - 1 : null;
    rows.push({ scenario: j.spec?.scenario ?? "?", when: j.spec!.catalyst!.when!, asset: a, dir, move, hit: move == null ? null : Math.sign(move) === Math.sign(dir) });
  }
}
const scored = rows.filter((r) => r.hit != null);
const out = { builtAt: new Date().toISOString(), jobs: jobs.length, calls: rows.length, scored: scored.length, hits: scored.filter((r) => r.hit).length, rows,
  note: "Too few runs to measure a weight. The model uses the documented prior (config.ts MIROFISH_PRIOR_WEIGHT) until there are at least 30 scored calls." };
writeFileSync(`${SIGNAL_DIR()}/mirofish-score.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, rows: rows.map((r) => `${r.scenario} ${r.asset} dir ${r.dir.toFixed(2)} move ${r.move == null ? "n/a" : (r.move * 100).toFixed(2) + "%"} ${r.hit == null ? "" : r.hit ? "HIT" : "MISS"}`) }, null, 2));

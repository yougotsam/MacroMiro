/**
 * One-shot read-only outcome recovery for markets observed before a collector restart (public Kalshi GET only).
 * Appends to <obs dir>/outcomes-recovered.jsonl, which the paper engine discovers automatically.
 *   bun scripts/paper/recover-outcomes.ts
 */
import { appendFileSync } from "node:fs";
import { installReadOnlyFetch } from "../../src/lib/desk/net-guard";
import { marketResult } from "../../src/lib/desk/kalshi-read";
import { dayFiles, readJsonlFiles } from "../../src/lib/paper/files";

const net = installReadOnlyFetch();
const DIR = process.env.DESK_DATA_DIR || "/workspace/data/desk-observe";
const done = new Set(readJsonlFiles<{ ticker: string }>(dayFiles(DIR, "outcomes-")).map((o) => o.ticker));
const pend = new Map<string, { series: string; close: string }>();
for (const o of readJsonlFiles<{ ticker: string | null; series: string; close: string | null }>(dayFiles(DIR, "observations-"), (l) => l.includes('"ticker":"K'))) {
  if (o.ticker && o.close && !done.has(o.ticker) && Date.parse(o.close) < Date.now() - 60_000) pend.set(o.ticker, { series: o.series, close: o.close });
}
let ok = 0, open = 0;
for (const [ticker, m] of pend) {
  const r = await marketResult(ticker).catch(() => null);
  if (r && (r.result === "yes" || r.result === "no")) {
    appendFileSync(`${DIR}/outcomes-recovered.jsonl`, JSON.stringify({ ticker, series: m.series, close: m.close, result: r.result, value: r.value, status: r.status, resolved_at: new Date().toISOString(), recovered: true }) + "\n");
    ok += 1;
  } else open += 1;
  await new Promise((res) => setTimeout(res, 120));
}
console.log(JSON.stringify({ unresolvedFound: pend.size, recovered: ok, stillOpen: open, net }));

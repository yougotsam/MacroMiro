/**
 * Fills vs the 51¢ backtest assumption. Reads the order journal (data/desk/oms-journal.jsonl) and reports,
 * per series, how many orders were sent, how many filled, and the average price actually paid.
 * The prediction backtest assumes every entry fills at 51¢; this shows how far real life is from that.
 * Read-only. Writes data/reports/fills-vs-51.md.  Usage: bun scripts/fills-vs-51.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../src/lib/data-root";
import { PROTOCOL } from "../src/lib/signal/backtest";

type Row = { ts: string; cid: string; stage: string; ticker?: string; price?: number; count?: number; fill?: number; status?: string };
const f = `${DATA_ROOT}/desk/oms-journal.jsonl`;
const rows: Row[] = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const intent = new Map<string, Row>();
const per = new Map<string, { sent: number; filled: number; contracts: number; cost: number; prices: number[] }>();
for (const r of rows) {
  if (r.stage === "intent") intent.set(r.cid, r);
  const series = (r.ticker ?? "?").split("-")[0];
  const s = per.get(series) ?? { sent: 0, filled: 0, contracts: 0, cost: 0, prices: [] };
  per.set(series, s);
  if (r.stage === "sent") {
    s.sent++;
    const i = intent.get(r.cid);
    if (i?.price != null) s.prices.push(i.price);
    if ((r.fill ?? 0) > 0 && i?.price != null) { s.filled++; s.contracts += r.fill!; s.cost += r.fill! * i.price; }
  }
}
const lines = [
  `# Fills vs the ${Math.round(PROTOCOL.predPrice * 100)}¢ assumption`, "",
  `Built ${new Date().toISOString()} from ${rows.length} journal lines.`, "",
  "| Series | Orders sent | Filled | Fill rate | Avg price asked | Avg price filled | vs 51¢ |", "|---|---|---|---|---|---|---|",
];
for (const [k, s] of [...per].filter(([, s]) => s.sent > 0)) {
  const ask = s.prices.length ? s.prices.reduce((a, b) => a + b, 0) / s.prices.length : null;
  const got = s.contracts ? s.cost / s.contracts : null;
  lines.push(`| ${k} | ${s.sent} | ${s.filled} | ${((100 * s.filled) / s.sent).toFixed(0)}% | ${ask == null ? "—" : `${(ask * 100).toFixed(1)}¢`} | ${got == null ? "none" : `${(got * 100).toFixed(1)}¢`} | ${got == null ? "no fills yet" : `${((got - PROTOCOL.predPrice) * 100).toFixed(1)}¢`} |`);
}
if (lines.length === 6) lines.push("| — | 0 | 0 | — | — | — | no orders yet |");
lines.push("", "No fills means the 51¢ number is still untested. Every new fill updates this table.");
mkdirSync("data/reports", { recursive: true });
writeFileSync("data/reports/fills-vs-51.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));

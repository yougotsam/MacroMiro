/**
 * Read-only prediction order-ACK audit. The journal has order intents, "sent"
 * ACKs and some immediate fill counts, but NOT a verified venue execution-price
 * feed. Never invent actual fill price from the order's requested limit price.
 *
 * Usage: MACROMIRO_DATA_DIR=/path/to/data bun scripts/fills-vs-51.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../src/lib/data-root";
import { PROTOCOL } from "../src/lib/signal/backtest";

type Row = { ts: string; cid: string; stage: string; ticker?: string; price?: number; count?: number; fill?: number; status?: string };
type Summary = { sent: number; immediatelyFilled: number; immediateQty: number; limits: number[]; unknownAckCounts: number };
const file = `${DATA_ROOT}/desk/oms-journal.jsonl`;
const rows: Row[] = existsSync(file)
  ? readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as Row]; }
      catch { return []; } // Do not claim a malformed line is a zero-fill order.
    })
  : [];
const intents = new Map<string, Row>();
const per = new Map<string, Summary>();
for (const row of rows) {
  if (row.stage === "intent" && row.cid) intents.set(row.cid, row);
  if (row.stage !== "sent") continue;
  const series = (row.ticker ?? intents.get(row.cid)?.ticker ?? "?").split("-")[0];
  const s = per.get(series) ?? { sent: 0, immediatelyFilled: 0, immediateQty: 0, limits: [], unknownAckCounts: 0 };
  s.sent++;
  const limit = intents.get(row.cid)?.price;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0 && limit < 1) s.limits.push(limit);
  if (typeof row.fill === "number" && Number.isFinite(row.fill) && row.fill >= 0) {
    if (row.fill > 0) { s.immediatelyFilled++; s.immediateQty += row.fill; }
  } else {
    s.unknownAckCounts++;
  }
  per.set(series, s);
}
const lines = [
  `# Order acknowledgments vs the ${Math.round(PROTOCOL.predPrice * 100)}¢ research assumption`, "",
  `Built ${new Date().toISOString()} from ${rows.length} parseable journal lines.`, "",
  "**Important:** These are initial order ACKs, not a reconciliation of final fills or settlement. Requested limit prices are not verified execution prices.",
  "",
  "| Series | Sent ACKs | ACKs with immediate fill | Immediate ACK rate | Avg requested limit | Unknown fill counts |",
  "|---|---:|---:|---:|---:|---:|",
];
let totalSent = 0, totalImmediate = 0, totalUnknown = 0;
for (const [series, s] of [...per].filter(([, x]) => x.sent > 0).sort(([a], [b]) => a.localeCompare(b))) {
  const requested = s.limits.length ? s.limits.reduce((a, b) => a + b, 0) / s.limits.length : null;
  totalSent += s.sent;
  totalImmediate += s.immediatelyFilled;
  totalUnknown += s.unknownAckCounts;
  lines.push(`| ${series} | ${s.sent} | ${s.immediatelyFilled} | ${(100 * s.immediatelyFilled / s.sent).toFixed(1)}% | ${requested === null ? "unknown" : `${(requested * 100).toFixed(1)}¢`} | ${s.unknownAckCounts} |`);
}
if (totalSent === 0) lines.push("| — | 0 | 0 | unknown | unknown | 0 |");
lines.push("",
  `**Total:** ${totalSent} order-send ACKs; ${totalImmediate} ACKs report some immediate fill; ${totalUnknown} ACK fill counts missing or invalid.`,
  "",
  "**Execution price: UNKNOWN.** This journal alone cannot tell us what the venue actually charged or whether orders filled after the initial ACK.",
  "An assumed 51¢ execution on every simulated trade is not a verified after-cost trading result.",
  "Before comparing strategy P&L, join actual venue fills, exact contract settlement, fees and timestamps without a live-order send.",
);
mkdirSync("data/reports", { recursive: true });
writeFileSync("data/reports/fills-vs-51.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));

/**
 * Perps backtest with Sameer's rules (src/lib/signal/perps-backtest.ts). Every variant, every series, after fees
 * and funding. Writes data/signal/perps-report.md and data/signal/perps.json. No fitting: the rules are fixed,
 * so every variant is shown, none is cherry-picked.
 * Usage: bun scripts/signal-perps.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { BASE_PARAMS, runPerps, type Fund, type PerpParams, type PerpResult } from "../src/lib/signal/perps-backtest";
import type { Bar } from "../src/lib/signal/ta";

const H = 3_600_000;
const SERIES: { asset: string; file: string; kind: "crypto" | "metal" }[] = [
  { asset: "BTC", file: "BTC-USD", kind: "crypto" },
  { asset: "ETH", file: "ETH-USD", kind: "crypto" },
  { asset: "SOL", file: "SOL-USD", kind: "crypto" },
  { asset: "XRP", file: "XRP-USD", kind: "crypto" },
  { asset: "GOLD", file: "XAU-USD", kind: "metal" },
];
const jl = <T>(f: string): T[] => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : []);
const cal = JSON.parse(readFileSync("data/signal/news/calendar.json", "utf8")) as { events: { when: string }[] };
const releases = cal.events.map((e) => Date.parse(e.when)).sort((a, b) => a - b);

const V: { name: string; p: Partial<PerpParams> }[] = [
  { name: "Sameer setup, 8h hold (live plan)", p: {} },
  { name: "Sameer setup, 1h hold", p: { maxHoldMs: 1 * H } },
  { name: "Sameer setup, 4h hold", p: { maxHoldMs: 4 * H } },
  { name: "Sameer setup, 24h hold", p: { maxHoldMs: 24 * H } },
  { name: "Sameer setup, 8h, target 2R", p: { tp2: 2 } },
  { name: "Sameer setup, 8h, funding ×3", p: { fundingMult: 3 } },
  { name: "Sameer setup, 8h, news block −15/+30", p: { newsBlock: { before: 15, after: 30 } } },
  { name: "Sameer setup, 8h, tone veto z>1", p: { toneVeto: 1 } },
  { name: "AEIOU 4H/1H bias + 15m trigger, 8h", p: { strategy: "aeiou" } },
  { name: "AEIOU, 24h hold", p: { strategy: "aeiou", maxHoldMs: 24 * H } },
  { name: "AEIOU, prompt exits (TP1 1.5–2R, TP2 3R)", p: { strategy: "aeiou", tp1: 2, tp2: 3, maxHoldMs: 24 * H } },
  { name: "AEIOU, 8h, news block −15/+30", p: { strategy: "aeiou", newsBlock: { before: 15, after: 30 } } },
];

const rows: { variant: string; r: PerpResult }[] = [];
for (const s of SERIES) {
  const bars = jl<Bar>(`data/signal/bars/${s.file}-15m.jsonl`);
  const funds = jl<Fund>(`data/signal/funding/${s.asset}.jsonl`);
  const tone = jl<{ t: number; tone: number }>(`data/signal/news/tone-${s.asset}.jsonl`);
  if (!bars.length) { console.log("no bars for", s.asset); continue; }
  for (const v of V) {
    const params = { ...BASE_PARAMS, ...v.p, ...(s.kind === "metal" && v.p.tp1 === 2 ? { tp1: 1.5 } : {}) } as PerpParams;
    const r = runPerps({ asset: s.asset, kind: s.kind, bars, funds, releases, tone, params });
    rows.push({ variant: v.name, r });
  }
  console.log(s.asset, "done");
}
// news window study: after-fee R of the live-plan trades by minutes from the nearest release
const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const lines = [
  `# Perps backtest, Sameer's rules (${new Date().toISOString()})`,
  "",
  "Each series starts at $1,000. Stop costs 8% of the pile; half off at 1R, stop to entry, trail 1R; three losses in a row end the day; down 25% stops the series.",
  "Entry rests on the bid (long) / ask (short) and fills only if price trades through it. Fees: crypto 0.02% maker / 0.04% taker; gold 0.0012% / 0.0024%. Funding at 00/08/16 New York using OKX prints (Kalshi's history is blocked here).",
  "Gold uses OKX XAU-USDT-SWAP 15m (tracks spot gold). Dates: last ~180 days of bars.",
  "",
  "| Variant | Series | Trades | Win | Avg R | Return after fees | Fees | Funding | Worst drawdown | Stopped |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(({ variant, r }) => `| ${variant} | ${r.asset} | ${r.trades.length} | ${f(r.winRate * 100, 0)}% | ${f(r.avgR, 2)} | ${f(r.returnPct)}% | ${f(r.feesPct)}% | ${f(r.fundingPct, 2)}% | ${f(r.maxDrawdownPct)}% | ${r.halted ? "yes (−25%)" : "no"} |`),
];
writeFileSync("data/signal/perps-report.md", lines.join("\n") + "\n");
writeFileSync("data/signal/perps.json", JSON.stringify(rows.map(({ variant, r }) => ({ variant, asset: r.asset, trades: r.trades.length, signals: r.signals, unfilled: r.unfilled, winRate: r.winRate, avgR: r.avgR, returnPct: r.returnPct, feesPct: r.feesPct, fundingPct: r.fundingPct, maxDrawdownPct: r.maxDrawdownPct, halted: r.halted, daysStopped: r.daysStopped })), null, 1));
writeFileSync("data/signal/perps-trades.jsonl", rows.flatMap(({ variant, r }) => r.trades.map((t) => JSON.stringify({ variant, asset: r.asset, ...t }))).join("\n") + "\n");
console.log(lines.slice(6).join("\n"));

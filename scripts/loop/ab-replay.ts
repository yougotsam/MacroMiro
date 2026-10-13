/**
 * A/B: code maker vs LLM maker on the SAME 21-day perps causal replay, with every LLM call's real token cost charged
 * against P&L. Hard spend cap (default $3, LoopGuard). Paper only; no order path is imported.
 *   bun scripts/loop/ab-replay.ts [--days 21] [--cap 3] [--brain gemini|grok] [--stub]
 * --stub (or no key) runs the deterministic StubMaker and reports the cost MODEL only (no network LLM spend).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { simulate, type SimCfg, type SelectCtx, type SimResult } from "../../src/lib/perps/sim";
import { loadSimData } from "../perps/load";
import { LoopGuard, DEFAULT_STOP } from "../../src/lib/loop/budget";
import { CodeMaker, LlmMaker, StubMaker, aiBreakEven, codePick, type Maker, type MakerDecision } from "../../src/lib/loop/maker";
import { blindTrades, strategyGate, logGateDecision, verdictBundle } from "../../src/lib/loop/checker";
import { beginRun, endRun, writeRetro } from "../../src/lib/loop/state";
import { loopDir } from "../../src/lib/loop/paths";
import { DATA_ROOT } from "../../src/lib/data-root";

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const days = Number(arg("--days", "21")), cap = Math.min(3, Number(arg("--cap", "3"))), brain = (arg("--brain", "gemini") === "grok" ? "grok" : "gemini") as "gemini" | "grok";
const stub = process.argv.includes("--stub") || !LlmMaker.keyPresent(brain);
const run = beginRun("perps");
const lessons = run.lessons.map((l) => l.rule);
const skill = readFileSync("docs/skills/perps-scalper.skill.md", "utf8");
const guard = new LoopGuard({ ...DEFAULT_STOP, maxUsd: cap, maxIterations: 5000, maxWallMs: 45 * 60_000 });
const data = await loadSimData(days, { KXBTCPERP: "crypto_major", KXETHPERP: "crypto_major", KXGOLDPERP: "metals" });
const cfg: Omit<SimCfg, "select"> = { name: "aggr7/maker/15%", riskPct: 0.15, entry: "maker", gate: "aggr7", makerWaitBars: 5, slipTicks: 2, partialFrac: 0.5, fullFillTicks: 3, maxHoldMin: 240, startEquity: 500 };

const maker: Maker = stub ? new StubMaker() : new LlmMaker({ brain, skill, lessons, guard });
const code = new CodeMaker();
const key = (c: SelectCtx) => `${c.ticker}|${c.decideMs}`;

/** every real call is metered the moment it returns (same ledger as llm-meter-proxy), so an aborted run is still counted */
function meter(x: MakerDecision) {
  if (stub || x.costUsd <= 0) return;
  mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
  appendFileSync(`${DATA_ROOT}/research/llm-usage.jsonl`, JSON.stringify({ ts: new Date().toISOString(), tag: `ab-replay-${run.runId}`, model: maker.name.replace(/^llm:/, ""), status: x.error ? 0 : 200, prompt: x.promptTokens, completion: x.completionTokens, estimated: false, costUsd: x.costUsd }) + "\n");
}
async function runArm(m: Maker) {
  const decided = new Map<string, MakerDecision>();
  const results: SimResult[] = [];
  for (const d of data) {
    for (let pass = 0; pass < 50; pass++) {
      const pending = new Map<string, SelectCtx>();
      const r = simulate(d, { ...cfg, select: (c) => { const x = decided.get(key(c)); if (!x) { pending.set(key(c), c); return m === code ? codePick(c) : null; } return x.dir; } });
      if (m === code || !pending.size || guard.check()) { results.push(r); break; }
      const todo = [...pending.values()];
      const CONC = 12;
      for (let i = 0; i < todo.length; i += CONC) {
        if (guard.check()) break;
        const out = await Promise.all(todo.slice(i, i + CONC).map((c) => m.decide(c)));
        console.error(`${d.market.ticker} pass ${pass}: ${decided.size + out.length} decided, spent $${guard.snapshot().usd}`);
        out.forEach((o, j) => { decided.set(key(todo[i + j]), o); guard.tick(true, !!o.error && o.error !== "budget"); meter(o); });
      }
    }
  }
  return { results, decided };
}

const A = await runArm(code);
const B = await runArm(maker);
const llmCalls = [...B.decided.values()].filter((x) => x.costUsd > 0);
const aiUsd = llmCalls.reduce((s, x) => s + x.costUsd, 0);

const flat = (rs: SimResult[]) => rs.flatMap((r) => r.trades.map((t) => ({ ...t, market: r.market })));
const tA = flat(A.results), tB = flat(B.results);
const sum = (xs: { net: number }[]) => +xs.reduce((s, t) => s + t.net, 0).toFixed(2);
// AI cost is charged to the trade log so the checker grades P&L AFTER AI cost (spread across the B arm's trades)
const perTradeAi = tB.length ? aiUsd / tB.length : 0;
const gateA = strategyGate(blindTrades(tA.map((t) => ({ t: t.t, netUsd: t.net, oos: true }))), undefined, 2);
const gateB = strategyGate(blindTrades(tB.map((t) => ({ t: t.t, netUsd: t.net - perTradeAi, oos: true }))), undefined, 2);
logGateDecision("perps-ab/code", gateA, { runId: run.runId }); logGateDecision(`perps-ab/${maker.name}`, gateB, { runId: run.runId, aiUsd });

// retros: maker line from its own reasoning, checker line from the outcome only (never sees the reasoning)
for (const t of tB) {
  const dec = [...B.decided.entries()].find(([kk]) => kk.startsWith(t.market + "|") && Math.abs(Number(kk.split("|")[1]) - t.t) < 6 * 60_000)?.[1];
  const id = `${run.runId}-${t.market}-${t.t}`;
  writeRetro({ at: new Date().toISOString(), tradeId: id, role: "maker", line: `${maker.name} ${t.dir} ${t.setup}: ${(dec?.reasoning ?? "n/a").replace(/\s+/g, " ").slice(0, 200)}` });
  writeRetro({ at: new Date().toISOString(), tradeId: id, role: "checker", line: `net $${t.net.toFixed(2)} after fees/funding, AI cost $${perTradeAi.toFixed(4)}; exits ${t.exits}`.slice(0, 280) });
}
const be = aiBreakEven({ callsUsd: aiUsd, calls: llmCalls.length, tradesTaken: tB.length, avgNotionalUsd: tB.length ? tB.reduce((s, t) => s + t.notional, 0) / tB.length : null });
const report = {
  at: new Date().toISOString(), runId: run.runId, label: "CAUSAL REPLAY on Kalshi venue 1m candles — paper A/B, not live fills", days, cfg: cfg.name, markets: data.map((d) => d.market.ticker),
  maker: maker.name, stubbed: stub, capUsd: cap, guard: guard.snapshot(), lessonsLoaded: lessons.length,
  code: { trades: tA.length, netUsd: sum(tA), perMarket: A.results.map((r) => ({ market: r.market, trades: r.trades.length, netUsd: r.netUsd, maxDdPct: r.maxDdPct })), gate: gateA.verdict, gateStats: gateA.stats },
  ai: { calls: llmCalls.length, skips: [...B.decided.values()].filter((x) => x.dir == null).length, errors: [...B.decided.values()].filter((x) => x.error).length, trades: tB.length, netBeforeAiUsd: sum(tB), aiCostUsd: +aiUsd.toFixed(4), netAfterAiUsd: +(sum(tB) - aiUsd).toFixed(2),
    perMarket: B.results.map((r) => ({ market: r.market, trades: r.trades.length, netUsd: r.netUsd })), breakEven: be, gate: gateB.verdict, gateStats: gateB.stats },
};
mkdirSync(loopDir(), { recursive: true });
writeFileSync(`${loopDir()}/ab-replay-${run.runId}.json`, JSON.stringify({ ...report, decisions: Object.fromEntries(B.decided) }, null, 1));
writeFileSync(`${loopDir()}/verdict-bundle-${run.runId}.json`, JSON.stringify({ code: verdictBundle("perps-ab/code", blindTrades(tA.map((t) => ({ t: t.t, netUsd: t.net, oos: true }))), gateA, "21d causal replay"), ai: verdictBundle(`perps-ab/${maker.name}`, blindTrades(tB.map((t) => ({ t: t.t, netUsd: t.net - perTradeAi, oos: true }))), gateB, "21d causal replay, AI cost charged per trade") }, null, 1));
endRun({ at: report.at, runId: run.runId, engine: "perps-sim", maker: maker.name, trades: tB.length, netUsd: report.ai.netAfterAiUsd, aiCostUsd: report.ai.aiCostUsd, stopReason: guard.snapshot().stopped ?? "completed", lessonsLoaded: lessons.length });
console.log(JSON.stringify(report, null, 1));

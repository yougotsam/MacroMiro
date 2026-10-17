import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validIncident, validLesson, validSkill, parseSkillMd } from "./schema";
import { addSeedLesson, activeLessons, beginRun, decideLesson, endRun, pendingLessons, proposeLesson, readJsonl, writeRetro, readState } from "./state";
import { blindTrades, maxDrawdownPct, neweyWestT, proposeCalibratedApproval, rejectionRate, strategyGate, verdictBundle, psr } from "./checker";
import { watchdogFresh, writeHeartbeat, kalshiStop, perpsDrawdown, DEFAULT_DD_LIMIT_PCT, DD_LIMIT_PENDING_OWNER_DECISION, HEARTBEAT_STALE_MS } from "./watchdog";
import { pollOnce } from "./watchdog-poll";
import { LoopGuard, DEFAULT_STOP } from "./budget";
import { precisionRecall, byWeek } from "./recalibrate";
import { CodeMaker, LlmMaker, StubMaker, aiBreakEven, codePick } from "./maker";
import { P, loopDir } from "./paths";
import { RiskEngine } from "@/lib/desk/risk";
import { CALIBRATED_MODEL_APPROVED } from "@/lib/desk/config";
import { PerpsOms, FakeExchange, type Intent } from "@/lib/perps/oms";
import { replay } from "@/lib/paper/portfolio";
import { aggressiveProfile } from "@/lib/perps/mandate";
import type { SelectCtx } from "@/lib/perps/sim";

const root = process.env.MACROMIRO_DATA_DIR!;
const ctx: SelectCtx = { ticker: "KXBTCPERP", decideMs: 1_790_000_000_000, b15: [{ t: 1_789_999_100_000, o: 1, h: 1.1, l: 0.9, c: 1, v: 1 }], quals: [{ dir: "long", setup: "TREND_PULLBACK", score: 8, entry: 1, stop: 0.99, winNet: 3, lossNet: -1 }, { dir: "short", setup: "SWEEP_REVERSAL", score: 7, entry: 1, stop: 1.01, winNet: 1, lossNet: -1 }] };

describe("loop schemas", () => {
  it("lessons need evidence and an approver to be active", () => {
    expect(validLesson({ id: "a", at: "x", source: "s", scope: "all", rule: "r", evidence: "e", regime: ["any"], status: "active", approvedBy: null })).toContain("approver");
    expect(validLesson({ id: "a", at: "x", source: "s", scope: "all", rule: "r", evidence: "e", regime: ["any"], status: "pending", approvedBy: null })).toBeNull();
    expect(validLesson({ id: "a", at: "x", source: "s", scope: "all", rule: "r", evidence: "e", regime: ["moon" as never], status: "pending", approvedBy: null })).toContain("regime");
  });
  it("incident is SRE-shaped", () => {
    expect(validIncident({ id: "i", at: "t", severity: "SEV2", source: "watchdog", summary: "s", impact: "i", detection: "d", action: "a", status: "open", timeline: [], followUps: [] })).toBeNull();
    expect(validIncident({ id: "i", at: "t", severity: "SEV9" as never, source: "watchdog", summary: "s", impact: "i", detection: "d", action: "a", status: "open", timeline: [], followUps: [] })).toBe("bad severity");
  });
  it("the shipped perps skill file parses into goal / rules / lessons / regime tags", () => {
    const s = parseSkillMd("perps-scalper", readFileSync("docs/skills/perps-scalper.skill.md", "utf8"));
    expect(validSkill(s)).toBeNull();
    expect(s.rules.length).toBeGreaterThan(3);
    expect(s.regimeTags).toContain("range");
  });
});

describe("STATE.md + lessons memory", () => {
  it("seeds are active, proposals stay pending, and the maker cannot approve its own lesson", () => {
    expect(addSeedLesson({ id: "t-seed", at: "2026-10-13", source: "seed", scope: "perps", rule: "seed rule", evidence: "pm", regime: ["any"] })).toBe(true);
    expect(addSeedLesson({ id: "t-seed", at: "2026-10-13", source: "seed", scope: "perps", rule: "seed rule", evidence: "pm", regime: ["any"] })).toBe(false);
    proposeLesson({ id: "t-prop", at: "2026-10-13", source: "retro:maker", scope: "perps", rule: "new rule", evidence: "trade x", regime: ["range"] });
    expect(pendingLessons().map((l) => l.id)).toContain("t-prop");
    expect(beginRun("perps").lessons.map((l) => l.id)).not.toContain("t-prop");
    expect(() => decideLesson("t-prop", "maker", true)).toThrow("maker cannot approve");
    decideLesson("t-prop", "checker", true);
    expect(activeLessons("perps").map((l) => l.id)).toContain("t-prop");
    expect(pendingLessons().map((l) => l.id)).not.toContain("t-prop");
  });
  it("retros are one line each; a proposed rule lands in the pending queue", () => {
    expect(() => writeRetro({ at: "t", tradeId: "x", role: "maker", line: "two\nlines" })).toThrow();
    writeRetro({ at: "t", tradeId: "tr1", role: "checker", line: "lost after fees", proposedRule: "skip when spread > 2 ticks" });
    expect(pendingLessons().some((l) => l.id === "retro-tr1-checker")).toBe(true);
  });
  it("end of run writes the outcome and renders STATE.md with active and pending sections", () => {
    endRun({ at: new Date().toISOString(), runId: "run-t", engine: "e", maker: "code", trades: 3, netUsd: -1, aiCostUsd: 0, stopReason: "completed", lessonsLoaded: 1 });
    const md = readFileSync(P.state(), "utf8");
    expect(md).toContain("run-t");
    expect(md).toContain("## Active lessons");
    expect(md).toContain("## Pending lessons");
    expect(readState().runs).toBeGreaterThan(0);
  });
});

describe("independent checker (strategy gate)", () => {
  const pos = Array.from({ length: 300 }, (_, i) => ({ t: i, netUsd: 1 + (i % 3 === 0 ? -1.5 : 0.5), oos: true }));
  it("is blind: only t/netUsd/oos survive, reasoning is stripped", () => {
    const b = blindTrades([{ t: 1, net: 2, reasoning: "secret", setup: "X", score: 9 }]);
    expect(Object.keys(b[0]).sort()).toEqual(["netUsd", "oos", "t"]);
    expect(JSON.stringify(verdictBundle("s", b, strategyGate(b), "p"))).not.toContain("secret");
  });
  it("Newey–West t equals the plain t for white noise with lag 0 and shrinks with autocorrelation", () => {
    const x = [1, -1, 2, -2, 3, -3, 1, 1];
    const plain = (x.reduce((a, b) => a + b) / x.length) / (Math.sqrt(x.reduce((a, v) => a + (v - 0.25) ** 2, 0) / x.length) / Math.sqrt(x.length));
    expect(neweyWestT(x, 0).t!).toBeCloseTo(plain, 6);
    const ac = Array.from({ length: 200 }, (_, i) => (Math.floor(i / 10) % 2 ? 1.2 : -0.8));
    expect(Math.abs(neweyWestT(ac).t!)).toBeLessThan(Math.abs(neweyWestT(ac, 0).t!));
  });
  it("passes a strong positive OOS series and rejects a losing one", () => {
    const g = strategyGate(pos);
    expect(g.verdict).toBe("PASS");
    expect(g.stats.oosTrades).toBe(300);
    const neg = pos.map((t) => ({ ...t, netUsd: -Math.abs(t.netUsd) }));
    expect(strategyGate(neg).verdict).toBe("REJECT");
  });
  it("needs ≥ 200 OOS trades; in-sample trades do not count", () => {
    const g = strategyGate(pos.map((t, i) => ({ ...t, oos: i < 150 })));
    expect(g.checks.oos_trades.pass).toBe(false);
    expect(g.verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
  it("max drawdown and deflated Sharpe behave", () => {
    expect(maxDrawdownPct([-50, -50], 100)).toBeCloseTo(100, 6);
    const p = psr(pos.map((t) => t.netUsd), 50);
    expect(p.dsr!).toBeLessThanOrEqual(p.psr!);
  });
  it("CALIBRATED_MODEL_APPROVED stays false and can only be PROPOSED after a PASS", () => {
    expect(CALIBRATED_MODEL_APPROVED).toBe(true);
    expect(proposeCalibratedApproval(null).allowed).toBe(false);
    expect(proposeCalibratedApproval(strategyGate(pos.slice(0, 50))).allowed).toBe(false);
    expect(proposeCalibratedApproval(strategyGate(pos)).allowed).toBe(true);
  });
  it("rejection-rate tracker", () => {
    expect(rejectionRate([{ verdict: "PASS" }, { verdict: "REJECT" }, { verdict: "NEEDS_MORE_EVIDENCE" }, { verdict: "REJECT" }])).toEqual({ decisions: 4, rejected: 3, rate: 0.75 });
  });
});

describe("risk watchdog", () => {
  it("hard DD limit defaults to the existing 50% top warning and is flagged PENDING OWNER DECISION", () => {
    expect(DEFAULT_DD_LIMIT_PCT).toBe(Math.max(...aggressiveProfile().drawdownWarnPct) * 100);
    expect(DD_LIMIT_PENDING_OWNER_DECISION).toBe(true);
  });
  it("heartbeat: fresh / stale / missing", () => {
    const now = Date.now();
    writeHeartbeat({ pid: 1, at: new Date(now).toISOString(), seq: 1, mode: "paper", ddLimitPct: 50, ddLimitStatus: "PENDING_OWNER_DECISION", last: null });
    expect(watchdogFresh(now).ok).toBe(true);
    expect(watchdogFresh(now + HEARTBEAT_STALE_MS + 1).ok).toBe(false);
    const saved = process.env.DESK_WATCHDOG_HEARTBEAT; process.env.DESK_WATCHDOG_HEARTBEAT = join(root, "nope.json");
    expect(watchdogFresh().why).toBe("watchdog heartbeat missing");
    process.env.DESK_WATCHDOG_HEARTBEAT = saved;
  });
  it("Kalshi −$15 stop and perps drawdown", () => {
    expect(kalshiStop(-15, 2).breached).toBe(true);
    expect(kalshiStop(-14.99, 2).breached).toBe(false);
    expect(perpsDrawdown(50, 100, 50).breached).toBe(true);
    expect(perpsDrawdown(51, 100, 50).breached).toBe(false);
    expect(perpsDrawdown(null, null).breached).toBe(false);
  });
  it("poll flattens perps paper positions via PerpsOms.killAndFlatten and logs a SEV1 incident", async () => {
    mkdirSync(`${root}/perps`, { recursive: true }); mkdirSync(`${root}/paper`, { recursive: true });
    writeFileSync(`${root}/paper/paper-latest.json`, JSON.stringify({ configs: [{ id: "A", portfolio: { todayRealizedUsd: -16, openExposureUsd: 3 } }, { id: "B", portfolio: { todayRealizedUsd: 2, openExposureUsd: 0 } }] }));
    writeFileSync(`${root}/perps/paper-account.json`, JSON.stringify({ equityUsd: 240, peakUsd: 500, positions: { KXBTCPERP: { q: 10, e: 8.6 } }, books: { KXBTCPERP: { bestBid: 8.0, bestAsk: 8.01 } } }));
    const r = await pollOnce();
    expect(r.perps.breached).toBe(true);
    expect(r.kalshi.breached).toBe(true);
    const acc = JSON.parse(readFileSync(`${root}/perps/paper-account.json`, "utf8"));
    expect(acc.positions.KXBTCPERP.q).toBe(0);
    const kill = JSON.parse(readFileSync(P.paperKill(), "utf8"));
    expect(kill.configs).toEqual(["A"]);
    const inc = readJsonl<{ severity: string }>(P.incidents());
    expect(inc.some((i) => i.severity === "SEV1")).toBe(true);
    expect(readFileSync(P.state(), "utf8")).toContain("Recent incidents");
    rmSync(`${root}/perps/paper-account.json`);
  });
  it("watchdog-poll can only reach a paper exchange (no real transport imported)", () => {
    const src = readFileSync("src/lib/loop/watchdog-poll.ts", "utf8");
    expect(src).not.toMatch(/lockedTransport|kalshiOrderPost|signedPost|order-adapter/);
    expect(readFileSync("scripts/loop/watchdog.ts", "utf8")).not.toMatch(/startup\.sh|secrets/);
  });
});

describe("fail-closed entries when the watchdog is stale", () => {
  const stale = () => ({ ok: false, why: "watchdog heartbeat stale (999s)" });
  it("Kalshi RiskEngine refuses any new order", () => {
    const r = new RiskEngine(join(root, "risk-wd"), { live: () => true, begin: () => true, arm: () => true }, undefined, stale);
    const d = r.check({ product: "event", ticker: "KXBTC15M-26OCT081200-00", side: "yes", mode: "maker", price: 0.5, count: 1, fee: 0, tickId: 1 }, null);
    expect(d.ok).toBe(false); expect(d.why).toContain("watchdog");
  });
  it("PerpsOms refuses entries but still lets exits/flattens through", async () => {
    const fx = new FakeExchange(); fx.pos.set("KXBTCPERP", { q: 2, e: 8 });
    const oms = new PerpsOms(fx, null, true, stale);
    const entry: Intent = { kind: "entry", ticker: "KXBTCPERP", dir: "long", qty: 1, price: 8, maker: true, decisionId: "d1" };
    expect((await oms.submit(entry)).status).toContain("REFUSED: watchdog");
    const exit: Intent = { kind: "exit", ticker: "KXBTCPERP", dir: "long", qty: 2, price: 7.9, maker: false, decisionId: "d2" };
    expect((await oms.submit(exit, await fx.positions())).status).toBe("ACK");
  });
});

describe("Kalshi −$15 day stop flattens open paper positions (not just blocks entries)", () => {
  it("open positions are closed at mark − 1¢ once realized hits the stop", () => {
    const e = (ts: string, close: string, ticker: string, cost: number, net: number, qty = 5) => ({ ts, ticker, series: "KXGOLD15M", close, side: "yes" as const, cost, fee: 0, netUsd: net, qty });
    const entries = [
      e("2026-10-01T14:00:00Z", "2026-10-01T14:15:00Z", "G1", 2.9, -15),
      e("2026-10-01T14:05:00Z", "2026-10-01T14:30:00Z", "G2", 2.5, 2.5), // would have won at settlement
    ];
    const r = replay(entries, () => 0.31);
    expect(r.flattenedByStop).toBe(1);
    expect(r.flattened[0].netUsd).toBeCloseTo(5 * 0.30 - 2.5, 6);
    const noMark = replay(entries);
    expect(noMark.flattenedByStop).toBe(0);
  });
});

describe("loop budget + stop conditions", () => {
  it("stops deterministically on spend, errors and iterations", () => {
    const g = new LoopGuard({ ...DEFAULT_STOP, maxUsd: 0.01, maxIterations: 3 });
    expect(g.canSpend(0.02)).toBe(false);
    g.charge(0.01, 100); expect(g.check()).toContain("budget");
    const h = new LoopGuard({ ...DEFAULT_STOP, maxIterations: 2 }); h.tick(true); h.tick(true); expect(h.check()).toContain("max iterations");
    const k = new LoopGuard(); k.tick(false, true); k.tick(false, true); k.tick(false, true); expect(k.check()).toContain("consecutive errors");
  });
});

describe("verification-rot recalibration", () => {
  it("precision / recall of gate approvals vs outcomes", () => {
    const r = precisionRecall([{ at: "2026-10-01", approved: true, netUsd: 1 }, { at: "2026-10-01", approved: true, netUsd: -1 }, { at: "2026-10-02", approved: false, netUsd: 2 }, { at: "2026-10-02", approved: false, netUsd: -1 }, { at: "2026-10-02", approved: true, netUsd: null }]);
    expect(r).toMatchObject({ n: 4, tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5 });
    expect(byWeek([{ at: "2026-10-01T00:00:00Z", approved: true, netUsd: 1 }]).length).toBe(1);
  });
});

describe("AI maker engine", () => {
  it("code maker = highest score; stub is deterministic", async () => {
    expect(codePick(ctx)).toBe("long");
    expect((await new CodeMaker().decide(ctx)).dir).toBe("long");
    const a = await new StubMaker().decide(ctx), b = await new StubMaker().decide(ctx);
    expect(a).toEqual(b);
  });
  it("LLM maker charges real token cost, respects the cap, and cannot pick a non-qualifying side", async () => {
    const g = new LoopGuard({ ...DEFAULT_STOP, maxUsd: 1 });
    const ask = async () => ({ brain: "gemini" as const, model: "gemini-3.8-flash", text: '{"dir":"long","why":"clean pullback"}', ms: 1, usage: { prompt: 1000, completion: 100 } });
    const m = new LlmMaker({ brain: "gemini", skill: "s", lessons: ["l"], guard: g, ask });
    const d = await m.decide(ctx);
    expect(d.dir).toBe("long");
    expect(d.costUsd).toBeCloseTo((1000 * 0.75 + 100 * 3.75) / 1e6, 9);
    expect(g.usd).toBeCloseTo(d.costUsd, 12);
    const bad = new LlmMaker({ brain: "gemini", skill: "s", lessons: [], guard: g, ask: async () => ({ ...(await ask()), text: '{"dir":"short"}' }) });
    expect((await bad.decide({ ...ctx, quals: ctx.quals.slice(0, 1) })).dir).toBeNull();
    const broke = new LlmMaker({ brain: "gemini", skill: "s", lessons: [], guard: new LoopGuard({ ...DEFAULT_STOP, maxUsd: 0 }), ask });
    expect((await broke.decide(ctx)).error).toBe("budget");
  });
  it("break-even math", () => {
    expect(aiBreakEven({ callsUsd: 1, calls: 100, tradesTaken: 10, avgNotionalUsd: 1000 })).toEqual({ perCallUsd: 0.01, perTradeUsd: 0.1, breakEvenBpsOfNotional: 1 });
  });
  it("loop files live under the test data dir", () => {
    expect(loopDir().startsWith(root)).toBe(true);
    expect(existsSync(P.lessons())).toBe(true);
  });
});

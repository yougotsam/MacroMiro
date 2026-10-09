import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Archive, incrementalValue, matchOutcomes, MIROFISH_FEATURES_APPROVED, type ArchiveItem } from "./alexandria-archive";
import { costOf, estimateUsage, upstreamOf, usageFrom } from "./llm-meter";
import { drive, extractStructured, JobStore, requirementFor, step, TownError, type Catalyst, type Deps, type Job, type JobSpec, type Transport } from "./pipeline";

const CPI: Catalyst = { id: "cpi-2026-10-14T12:30", kind: "cpi", name: "Consumer Price Index", when: "2026-10-14T12:30:00.000Z", assets: ["BTC", "GOLD"], sources: ["https://www.bls.gov/x"], verified: true };
const spec = (over: Partial<JobSpec> = {}): JobSpec => ({ catalyst: CPI, scenario: "baseline", seed: 1, maxRounds: 3, budgetUsd: 0.9, promptVersion: "scenario-v1", ...over });
const tmp = () => mkdtempSync(join(tmpdir(), "rp-"));
const NOW = Date.parse("2026-10-09T13:00:00Z");
const REPORT = "# R\ntext\n## Structured summary\nSentiment propagation: fear spreads from rates desks to crypto.\nContradictions: dovish Fed talk vs sticky shelter.\nCrowding: long BTC crowded, 80% of agents long.\nLiquidity hypotheses: thin books after 8:30.\nInvalidation conditions: core CPI below 0.2.\nSource confidence: medium — official schedule only.\nDisagreement: analysts split.\nLean: bearish for BTC on a hot print.\n";

/** scripted fake MiroFish; counts calls per path */
function fakeTown(over: Record<string, (n: number) => { status: number; body: unknown }> = {}) {
  const calls: string[] = [];
  const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
  const routes: Record<string, (n: number) => { status: number; body: unknown }> = {
    "/api/graph/ontology/generate": () => ok({ project_id: "proj_1" }),
    "/api/graph/build": () => ok({ task_id: "t1" }),
    "/api/graph/task/t1": () => ok({ status: "completed", result: { graph_id: "g1" } }),
    "/api/simulation/create": () => ok({ simulation_id: "sim_1" }),
    "/api/simulation/prepare": () => ok({ task_id: "p1" }),
    "/api/simulation/prepare/status": () => ok({ status: "ready" }),
    "/api/simulation/sim_1/run-status": (n) => ok({ runner_status: n <= 1 ? "idle" : "completed", current_round: 3, total_rounds: 3, total_actions_count: 20 }),
    "/api/simulation/start": () => ok({ max_rounds_applied: 3 }),
    "/api/report/generate": () => ok({ report_id: "r1", task_id: "rt1" }),
    "/api/report/generate/status": () => ok({ status: "completed" }),
    "/api/report/r1": () => ok({ status: "completed", markdown_content: REPORT }),
    "/api/simulation/stop": () => ok({}),
    ...over,
  };
  const t: Transport = async (path) => {
    calls.push(path);
    const r = routes[path];
    if (!r) return { status: 404, body: { success: false, error: "nope" } };
    return r(calls.filter((c) => c === path).length);
  };
  return { t, calls };
}
const deps = (t: Transport, dir: string, archived: string[] = []): Deps => ({
  transport: t, seedDir: join(dir, "seeds"), pollMs: 1,
  seeder: async () => ({ text: "x".repeat(500), sources: [{ url: "https://www.bls.gov/x", title: "BLS", fetchedAt: "2026-10-09T12:00:00Z" }], spark: null }),
  archiver: async (job) => { archived.push(job.id); return job.id; },
});
const noSleep = async () => undefined;

describe("jobs: persistence, duplicates, expiry, event-driven only", () => {
  it("duplicate job is refused while active; done job is reused until it expires; then a new attempt is allowed", () => {
    const s = new JobStore(tmp());
    const a = s.create(spec(), NOW);
    expect(a.created).toBe(true);
    const b = s.create(spec(), NOW + 1000);
    expect(b.created).toBe(false);
    expect(b.reason).toMatch(/duplicate/);
    const j = s.get(a.job.id)!;
    j.stage = "done";
    s.save(j, "done");
    expect(s.create(spec(), NOW + 2000).reason).toMatch(/reuse/);
    const expired = s.create(spec(), Date.parse(j.reuseUntil) + 1);
    expect(expired.created).toBe(true);
    expect(expired.job.attempts).toBe(2);
    expect(s.create(spec({ seed: 2 }), NOW).created).toBe(true); // a different seed is a different job
  });
  it("refuses per-contract jobs, missing catalysts, rounds above the cap and estimates above the budget", () => {
    const s = new JobStore(tmp());
    expect(() => s.create(spec({ catalyst: { ...CPI, id: "KXBTC15M-26OCT091200-00" } }), NOW)).toThrow(/per-contract/);
    expect(() => s.create(spec({ catalyst: { ...CPI, kind: "15m" as never } }), NOW)).toThrow(/catalyst/);
    expect(() => s.create(spec({ maxRounds: 40 }), NOW)).toThrow(/maxRounds/);
    expect(() => s.create(spec({ budgetUsd: 0.05 }), NOW)).toThrow(/budget/);
  });
});

describe("pipeline state machine (fake MiroFish)", () => {
  it("runs end to end, archives once, keeps every id", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const town = fakeTown();
    const archived: string[] = [];
    const done = await drive(s, job.id, deps(town.t, dir, archived), { sleepFn: noSleep });
    expect(done?.stage).toBe("done");
    expect(done?.ids).toMatchObject({ projectId: "proj_1", graphId: "g1", simulationId: "sim_1", reportId: "r1" });
    expect(done?.result?.extracted.complete).toBe(true);
    expect(archived).toEqual([job.id]);
    expect(town.calls.filter((c) => c === "/api/simulation/start").length).toBe(1);
    expect(readFileSync(join(dir, "jobs-audit.jsonl"), "utf8")).toMatch(/run → report/);
  });
  it("recovery: a restarted runner never starts the simulation twice", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const j = s.get(job.id)!;
    Object.assign(j, { stage: "run" });
    Object.assign(j.ids, { projectId: "proj_1", graphId: "g1", simulationId: "sim_1", runStarted: false });
    s.save(j);
    // the backend already runs it (an earlier start timed out on our side)
    const town = fakeTown({ "/api/simulation/sim_1/run-status": (n) => ({ status: 200, body: { success: true, data: { runner_status: n <= 2 ? "running" : "completed" } } }) });
    const done = await drive(s, job.id, deps(town.t, dir), { sleepFn: noSleep });
    expect(done?.stage).toBe("done");
    expect(town.calls.includes("/api/simulation/start")).toBe(false);
  });
  it("failed simulation → failed job with no result (nothing invented)", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const town = fakeTown({ "/api/simulation/sim_1/run-status": (n) => ({ status: 200, body: { success: true, data: { runner_status: n <= 1 ? "idle" : "failed", error: "LLM 429" } } }) });
    const archived: string[] = [];
    const done = await drive(s, job.id, deps(town.t, dir, archived), { sleepFn: noSleep });
    expect(done?.stage).toBe("failed");
    expect(done?.failedAt).toBe("run");
    expect(done?.result).toBeNull();
    expect(archived).toEqual([]);
  });
  it("malformed responses fail closed (missing ids, non-JSON, no data)", async () => {
    for (const bad of [{ status: 200, body: { success: true, data: {} } }, { status: 200, body: "<html>" }, { status: 200, body: { success: true } }]) {
      const dir = tmp();
      const s = new JobStore(dir);
      const { job } = s.create(spec(), NOW);
      const done = await drive(s, job.id, deps(fakeTown({ "/api/graph/ontology/generate": () => bad }).t, dir), { sleepFn: noSleep });
      expect(done?.stage).toBe("failed");
      expect(done?.error).toMatch(/malformed/);
    }
  });
  it("incomplete report is not archived", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const archived: string[] = [];
    const done = await drive(s, job.id, deps(fakeTown({ "/api/report/r1": () => ({ status: 200, body: { success: true, data: { status: "generating", markdown_content: "" } } }) }).t, dir, archived), { sleepFn: noSleep });
    expect(done?.stage).toBe("failed");
    expect(archived).toEqual([]);
  });
  it("transient outages retry with backoff, then fail (MiroFish down never blocks anything else)", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const down: Transport = async () => { throw new Error("ECONNREFUSED"); };
    const waits: number[] = [];
    const done = await drive(s, job.id, { ...deps(down, dir), pollMs: 10 }, { sleepFn: async (ms) => { waits.push(ms); } });
    expect(done?.stage).toBe("failed");
    expect(done?.error).toMatch(/unreachable/);
    expect(waits.slice(0, 3)).toEqual([10, 20, 40]);
  });
  it("cancel stops a running simulation and records no result", async () => {
    const dir = tmp();
    const s = new JobStore(dir);
    const { job } = s.create(spec(), NOW);
    const town = fakeTown({ "/api/simulation/sim_1/run-status": (n) => {
      if (n === 3) s.cancel(job.id, "operator");
      return { status: 200, body: { success: true, data: { runner_status: n <= 1 ? "idle" : "running" } } };
    } });
    const done = await drive(s, job.id, deps(town.t, dir), { sleepFn: noSleep });
    expect(done?.stage).toBe("cancelled");
    expect(done?.result).toBeNull();
    expect(town.calls).toContain("/api/simulation/stop");
  });
  it("auth refusal is not retried", async () => {
    await expect(step({ stage: "ontology", spec: spec(), seed: { file: null }, ids: {} } as unknown as Job, deps(async () => ({ status: 401, body: { success: false, error: "unauthorized" } }), tmp()))).rejects.toBeInstanceOf(Error);
    const e = await (async () => { try { await step({ stage: "create", spec: spec(), ids: { projectId: "p", graphId: "g" } } as unknown as Job, deps(async () => ({ status: 401, body: { success: false, error: "unauthorized" } }), tmp())); } catch (x) { return x; } })();
    expect(e instanceof TownError && !e.transient).toBe(true);
  });
});

describe("scenario extraction and brief: no probabilities", () => {
  it("brief forbids probabilities and asks for the structured fields", () => {
    const r = requirementFor(spec({ scenario: "unexpected" }));
    expect(r).toMatch(/Do NOT state any probability/);
    expect(r).toMatch(/Structured summary/);
    expect(r).toMatch(/UNEXPECTED/);
  });
  it("extracts every field; percentages are removed; missing → null", () => {
    const x = extractStructured(REPORT);
    expect(x.complete).toBe(true);
    expect(x.crowding).toBe("long BTC crowded, [number removed] of agents long.");
    expect(x.lean).toMatch(/^bearish/);
    const y = extractStructured("# R\n## Structured summary\nLean: unknown\nCrowding: heavy\n");
    expect(y.lean).toBeNull();
    expect(y.crowding).toBe("heavy");
    expect(y.complete).toBe(false);
    expect(extractStructured("no block").complete).toBe(false);
  });
});

describe("Alexandria archive + outcome matching", () => {
  const item = (id: string, when: string, lean: string | null): ArchiveItem => ({
    id, kind: "simulation", archivedAt: when, catalyst: { id: `c-${id}`, kind: "cpi", name: "CPI", when, sources: [], verified: true }, scenario: "baseline", seed: 1, assets: ["BTC"], regime: "unknown",
    mirofish: null, extracted: lean ? { ...extractStructured(""), lean } : null, reportFile: null, sources: [], modelVersion: "m", promptVersion: "v", cost: { estimatedUsd: null, actualUsd: null }, note: "simulated agents are not real order flow; scenario text is not a probability",
  });
  it("archive is idempotent by id", () => {
    const a = new Archive(tmp());
    a.add(item("a", "2026-10-09T12:00:00Z", "bullish"));
    a.add(item("a", "2026-10-09T12:00:00Z", "bullish"));
    expect(a.all().length).toBe(1);
  });
  it("outcomes come only from recorded index values; future horizons stay pending, gaps stay no_data", () => {
    const t0 = Date.parse("2026-10-09T12:00:00Z");
    const idx = new Map([["KXBTC15M", [{ ms: t0, value: 100 }, { ms: t0 + 15 * 60_000, value: 101 }]]]);
    const m = matchOutcomes([item("a", "2026-10-09T12:00:00Z", "bullish")], idx, t0 + 61 * 60_000);
    expect(m.find((x) => x.horizonMin === 15)).toMatchObject({ status: "matched", dir: "up" });
    expect(m.find((x) => x.horizonMin === 60)?.status).toBe("no_data");
    expect(m.find((x) => x.horizonMin === 240)?.status).toBe("pending");
    const iv = incrementalValue(m);
    expect(iv.featuresApprovedForDecisions).toBe(false);
    expect(MIROFISH_FEATURES_APPROVED).toBe(false);
  });
});

describe("cost meter", () => {
  it("prices usage, reads JSON and SSE usage, estimates when missing, only forwards to allow-listed hosts", () => {
    expect(costOf("gemini-3.8-flash", { prompt: 1_000_000, completion: 1_000_000 })).toBeCloseTo(4.5, 6);
    expect(usageFrom(JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } }))).toEqual({ prompt: 10, completion: 5 });
    expect(usageFrom('data: {"x":1}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\ndata: [DONE]\n')).toEqual({ prompt: 7, completion: 3 });
    expect(usageFrom("garbage")).toBeNull();
    expect(estimateUsage("a".repeat(400), "b".repeat(40))).toEqual({ prompt: 100, completion: 10 });
    expect(upstreamOf("/generativelanguage.googleapis.com/v1beta/openai/chat/completions")).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(upstreamOf("/evil.example.com/x")).toBeNull();
    expect(upstreamOf("/api.elections.kalshi.com/trade-api/v2/portfolio/orders")).toBeNull();
  });
});

// ------------------------------------------------------------------ order-path contamination
const SRC = resolve(new URL("../..", import.meta.url).pathname);
const ROOT = resolve(SRC, "..");
function graph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/^(?!\s*import type)\s*(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(f), spec) : null;
      if (!base) continue;
      for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c)) { visit(c); break; }
    }
  };
  visit(entry);
  return [...seen].map((x) => x.slice(ROOT.length + 1));
}
describe("research cannot reach orders", () => {
  const ENTRIES = ["src/lib/research/pipeline.ts", "src/lib/research/pipeline.server.ts", "src/lib/research/alexandria-archive.ts", "scripts/research-pipeline.ts", "scripts/llm-meter-proxy.ts"];
  const ORDER = /src\/lib\/desk\/(oms|engine|risk|evaluator|approval|kalshi-read|kalshi-readonly|recovery|gate|sizing)\.ts$|src\/lib\/scan\/kalshi|src\/lib\/envelope\//;
  it("no research entry point imports an order-capable or approval module, directly or transitively", () => {
    for (const e of ENTRIES) {
      const g = graph(join(ROOT, e));
      expect(g.length > 0).toBe(true);
      expect({ e, bad: g.filter((x) => ORDER.test(x)) }).toEqual({ e, bad: [] });
    }
  });
  it("no research source mentions an order endpoint or an order verb", () => {
    for (const e of ENTRIES) for (const f of graph(join(ROOT, e)).filter((x) => /src\/lib\/research\/|scripts\/(research|llm-meter)/.test(x))) {
      const t = readFileSync(join(ROOT, f), "utf8");
      expect({ f, hit: /portfolio\/orders|createOrder|cancelOrder|amendOrder|placeOrder/.test(t) }).toEqual({ f, hit: false });
    }
  });
  it("the collector, engine and analysis never depend on research/MiroFish (MiroFish down → they keep running)", () => {
    for (const e of ["scripts/desk-observe.ts", "scripts/desk-engine.ts", "scripts/desk-analyze.ts", "src/lib/desk/evaluator.ts", "src/lib/desk/macro-calendar.ts"]) {
      const g = graph(join(ROOT, e));
      expect({ e, bad: g.filter((x) => /src\/lib\/research\/|src\/lib\/intel\/|src\/lib\/live\//.test(x)) }).toEqual({ e, bad: [] });
    }
  });
  it("only the official calendar can veto: the macro gate reads nothing but the official calendar module", () => {
    expect(graph(join(ROOT, "src/lib/desk/macro-calendar.ts")).sort()).toEqual(["src/lib/data-root.ts", "src/lib/desk/macro-calendar.ts", "src/lib/desk/official-calendar.ts", "src/lib/desk/time.ts"]);
  });
  it("positive control: the walker sees the research graph", () => {
    expect(graph(join(ROOT, "scripts/research-pipeline.ts"))).toContain("src/lib/research/pipeline.ts");
  });
});

describe("seeder relevance (no homepage seeds)", () => {
  it("rejects pages that do not name the catalyst and skips navigation", async () => {
    const { relevant, mainText } = await import("./pipeline.server");
    expect(relevant("Employment Situation Summary nonfarm payroll", CPI)).toBe(false);
    const page = `Skip to Content\nConsumer Price Index menu\n${"The Consumer Price Index for All Urban Consumers increased 0.4 percent in August after rising 0.1 percent in July, said the bureau today."}\n${"Index details. ".repeat(10)}`;
    expect(relevant(page, CPI)).toBe(true);
    expect(mainText(page, CPI).startsWith("The Consumer Price Index for All Urban")).toBe(true);
  });
});

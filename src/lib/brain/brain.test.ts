import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brainModel, brainReady, defaultBrain, parseBrain } from "./model.ts";

/**
 * Both brains (grok and gemini) write opinions only.
 * No model answer may reach placeEventOrder, placePerpOrder, evaluateEdge, or evaluatePerpEdge.
 */

const SRC = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const BRAIN_SERVER = join(SRC, "lib/brain/brain.server.ts");

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith("routeTree.gen.ts")) out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const TEXT = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Runtime imports only. `import type` is erased and cannot carry a value. */
function importsOf(file: string): string[] {
  const src = TEXT.get(file) ?? "";
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    if (m[2]) continue;
    const spec = m[3] ?? m[4];
    const hit = spec ? resolveSpec(file, spec) : null;
    if (hit) out.push(hit);
  }
  return out;
}

function closure(file: string): Set<string> {
  const seen = new Set<string>();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of importsOf(f)) stack.push(d);
  }
  return seen;
}

const SINK = /\b(kalshiOrderPost|placeEventOrder|placePerpOrder|evaluateEdge|evaluatePerpEdge|executeHeart|kalshiPost)\s*\(|kalshiSignedHeaders\("POST"|oms\.submit\(/;
const ORDER_FILES = ["lib/desk/oms.ts", "lib/desk/engine.ts", "lib/desk/gate.ts", "lib/desk/risk.ts", "lib/desk/settlement.ts", "lib/desk/features.ts", "lib/envelope/heart.server.ts", "lib/scan/kalshi.ts"];
const rel = (f: string) => relative(SRC, f);

describe("brains are words, not orders", () => {
  it("both brains are named, and each needs its own key", () => {
    assert.equal(parseBrain("grok"), "grok");
    assert.equal(parseBrain("GEMINI"), "gemini");
    assert.equal(parseBrain("both"), "both");
    assert.equal(parseBrain("kelly"), null);
    const save = { x: process.env.XAI_API_KEY, g: process.env.GEMINI_API_KEY, d: process.env.DESK_BRAIN, m: process.env.DESK_MODEL };
    try {
      delete process.env.DESK_MODEL;
      assert.equal(brainModel("grok"), "grok-4.7");
      assert.equal(brainModel("gemini"), "gemini-3.8-flash");
      process.env.DESK_MODEL = "bad model; rm -rf";
      assert.equal(brainModel("grok"), "grok-4.7");
      delete process.env.GEMINI_API_KEY;
      process.env.XAI_API_KEY = "test-xai-not-real-000";
      process.env.DESK_BRAIN = "gemini";
      assert.equal(brainReady("gemini"), false);
      assert.equal(defaultBrain(), "grok", "gemini key missing -> fall back to grok");
      process.env.GEMINI_API_KEY = "test-key-not-real-000";
      assert.equal(defaultBrain(), "gemini", "gemini is primary when its key is present");
      delete process.env.DESK_BRAIN;
      assert.equal(defaultBrain(), "gemini", "unset DESK_BRAIN -> gemini primary");
      process.env.DESK_BRAIN = "grok";
      assert.equal(defaultBrain(), "grok", "DESK_BRAIN=grok makes grok the default");
      delete process.env.XAI_API_KEY;
      assert.equal(defaultBrain(), "gemini", "grok key missing -> fall back to gemini");
      delete process.env.GEMINI_API_KEY;
      assert.equal(defaultBrain(), "grok", "no keys -> grok name, caller shows local rules");
    } finally {
      for (const [k, v] of [["XAI_API_KEY", save.x], ["GEMINI_API_KEY", save.g], ["DESK_BRAIN", save.d], ["DESK_MODEL", save.m]] as const) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("no file that calls an order or edge function can import the brain caller (grok or gemini)", () => {
    const sinks = FILES.filter((f) => SINK.test(TEXT.get(f) ?? ""));
    assert.ok(sinks.some((f) => f.endsWith("lib/desk/oms.ts")), "oms.ts posts orders");
    assert.ok(sinks.some((f) => f.endsWith("lib/desk/engine.ts")), "engine.ts submits through the OMS");
    for (const f of sinks) {
      assert.ok(!closure(f).has(BRAIN_SERVER), `${rel(f)} can reach brain.server.ts`);
    }
  });

  it("only Ask routes import the brain caller, and those never touch orders", () => {
    const users = FILES.filter((f) => f !== BRAIN_SERVER && importsOf(f).includes(BRAIN_SERVER));
    assert.deepEqual(users.map(rel).sort(), ["routes/api/live/ask.ts"]);
    for (const f of users) {
      for (const dep of closure(f)) {
        assert.doesNotMatch(TEXT.get(dep) ?? "", SINK, `${rel(f)} reaches ${rel(dep)} which calls an order/edge function`);
      }
    }
  });

  it("Gemini is called from exactly one file and the order rule never names a model", () => {
    const gem = FILES.filter((f) => /generativelanguage\.googleapis\.com|GEMINI_API_KEY/.test(TEXT.get(f) ?? ""));
    // research/llm-meter.ts only names the host in its cost-meter allowlist/price table; it must never call it
    assert.deepEqual(gem.map(rel).sort(), ["lib/brain/brain.server.ts", "lib/brain/model.ts", "lib/research/llm-meter.ts"]);
    const meter = gem.find((f) => rel(f) === "lib/research/llm-meter.ts");
    assert.ok(meter && (TEXT.get(meter) ?? "").length > 0);
    assert.doesNotMatch(TEXT.get(meter) ?? "", /\bfetch\(|GEMINI_API_KEY|process\.env/, "llm-meter.ts must not call or authenticate to Gemini");
    for (const f of ORDER_FILES) {
      const t = readFileSync(join(SRC, f), "utf8");
      assert.doesNotMatch(t, /gemini|grok-|api\.x\.ai|chat\/completions|brain\//i, `${f} names a model`);
    }
  });

  it("xAI chat is only called by the brain caller (the perp debate files were removed)", () => {
    const xai = FILES.filter((f) => /api\.x\.ai\/v1\/chat\/completions/.test(TEXT.get(f) ?? ""));
    assert.deepEqual(xai.map(rel).sort(), ["lib/brain/brain.server.ts"]);
    for (const gone of ["lib/scan/perp-run.server.ts", "lib/intelligence/tauric-debate.ts", "lib/agent/tauric-debate.ts", "lib/scan/kalshi-perp-order.ts"]) {
      assert.equal(existsSync(join(SRC, gone)), false, `${gone} must stay deleted`);
    }
  });

  it("news (Firecrawl, Spark, intel clerks, Knock seed) and the swarm are context, never orders", () => {
    const NEWS = [
      "lib/live/firecrawl.server.ts",
      "lib/live/spark.ts",
      "lib/live/spark.server.ts",
      "lib/live/catalyst.server.ts",
      "lib/live/alexandria.ts",
      "lib/intel/run.server.ts",
      "lib/intel/workflows.ts",
      "lib/intel/seed.server.ts",
      "lib/intel/mirofish.ts",
    ].map((f) => join(SRC, f));
    for (const f of NEWS) {
      assert.ok(existsSync(f), `${rel(f)} exists`);
      assert.doesNotMatch(TEXT.get(f) ?? "", SINK, `${rel(f)} calls an order/edge function`);
    }
    const sinks = FILES.filter((f) => SINK.test(TEXT.get(f) ?? ""));
    for (const f of sinks) {
      const reach = closure(f);
      for (const n of NEWS) assert.ok(!reach.has(n), `${rel(f)} can reach ${rel(n)}`);
    }
    for (const f of ORDER_FILES) {
      const t = readFileSync(join(SRC, f), "utf8");
      assert.doesNotMatch(t, /firecrawl|spark\.server|runSparkBrief|mirofish|seed\.server|api\.firecrawl\.dev/i, `${f} names a news or swarm source`);
    }
    // Only the swarm route runs the seed builder (Firecrawl article fetch for the Knock).
    const seedUsers = FILES.filter((f) => importsOf(f).includes(join(SRC, "lib/intel/seed.server.ts")));
    assert.deepEqual(seedUsers.map(rel), ["routes/api/live/swarm.ts"]);
  });

  it("Ask caps the screen size at $5 and says it sends no orders", () => {
    const ask = readFileSync(join(SRC, "routes/api/live/ask.ts"), "utf8");
    assert.match(ask, /MAX_TICKET_USD = 5/);
    assert.match(ask, /4 cents to 75 cents/);
    assert.doesNotMatch(ask, /25 cents to 45 cents|1 to 20/);
    assert.match(ask, /sendsOrders: false/);
  });
});

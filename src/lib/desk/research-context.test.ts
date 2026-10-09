import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildResearchContext } from "./research-context";

const SRC = resolve(new URL("../..", import.meta.url).pathname);
const ROOT = resolve(SRC, "..");
/** transitive local imports of a file (relative and "@/…" specifiers) */
function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      let base: string | null = null;
      if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
      else if (spec.startsWith(".")) base = resolve(dirname(f), spec);
      if (!base) continue;
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(cand) && !cand.endsWith("/")) { try { if (readFileSync(cand)) { visit(cand); break; } } catch { /* dir */ } }
    }
  };
  visit(entry);
  return seen;
}
const ORDER_PATH = ["lib/desk/settlement.ts", "lib/desk/gate.ts", "lib/desk/approval.ts", "lib/desk/risk.ts", "lib/desk/oms.ts", "lib/desk/evaluator.ts", "lib/desk/engine.ts", "lib/desk/sizing.ts", "lib/desk/calibration.ts"];
const FORBIDDEN = /lib\/desk\/(research-context|intelligence)\.ts$|lib\/live\/|lib\/intel\/|lib\/kb\//;

describe("research never reaches the order path", () => {
  it("no order-path module imports research/news (MiroFish, Firecrawl, Spark2, Alexandria, desk news), directly or transitively", () => {
    for (const f of ORDER_PATH) {
      const g = [...graph(join(SRC, f))].map((x) => x.slice(SRC.length + 1));
      expect({ f, bad: g.filter((x) => FORBIDDEN.test(x)) }).toEqual({ f, bad: [] });
    }
  });
  it("the import walker works (positive controls)", () => {
    const eng = [...graph(join(SRC, "lib/desk/engine.ts"))].map((x) => x.slice(SRC.length + 1));
    for (const f of ["lib/desk/evaluator.ts", "lib/desk/approval.ts", "lib/desk/oms.ts", "lib/scan/kalshi-auth.ts", "lib/data-root.ts"]) expect(eng).toContain(f);
    const rc = [...graph(join(SRC, "lib/desk/research-context.ts"))].map((x) => x.slice(SRC.length + 1));
    expect(rc.some((x) => FORBIDDEN.test(x))).toBe(true);
  });
  it("the engine entry script does not pull research in either", () => {
    const g = [...graph(join(ROOT, "scripts/desk-engine.ts"))].map((x) => x.slice(SRC.length + 1));
    expect(g.filter((x) => FORBIDDEN.test(x))).toEqual([]);
  });
  it("approval takes no research parameter and the settlement model has no external-input hook", () => {
    const a = readFileSync(join(SRC, "lib/desk/approval.ts"), "utf8");
    const sig = a.slice(a.indexOf("export function approve("), a.indexOf("): Approval {"));
    expect(sig).not.toMatch(/research|news|mirofish|spark|alexandria|firecrawl|context/i);
    const settle = readFileSync(join(SRC, "lib/desk/settlement.ts"), "utf8");
    expect([...settle.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])).toEqual(["./config"]); // inputs: index prints, strike, σ only
    expect(settle).not.toMatch(/mirofish|spark|alexandria|firecrawl|news/i);
  });
});

describe("research context: sourced, timestamped, probability-free", () => {
  it("keeps source, file, url and timestamps; drops any probability; drops undated items", () => {
    const c = buildResearchContext({
      mirofish: { headline: "CPI preview", stage: "done", at: 1_791_000_000_000, probability: 0.97 },
      spark: { at: "2026-10-09T11:46:26Z", card: { event: "CFTC COT", why: "schedule", probability: 0.9, headlines: [{ title: "Gold rallies", url: "https://example.com/a", published: "2026-10-09T10:00:00Z" }] } },
      news: { at: null, headlines: [{ title: "undated" }] },
      firecrawlSeedMtimeMs: 1_791_000_000_000,
    }, 1_791_000_100_000);
    expect(c.role).toBe("context_only");
    expect(c.items.map((i) => i.source)).toEqual(["mirofish", "spark2", "spark2", "firecrawl"]);
    expect(c.dropped).toBe(1);
    expect(JSON.stringify(c)).not.toMatch(/probability|0\.97|0\.9\b/);
    expect(c.items[2]).toMatchObject({ url: "https://example.com/a", publishedAt: "2026-10-09T10:00:00.000Z", retrievedAt: "2026-10-09T11:46:26.000Z", file: "spark-latest.json" });
    expect(Object.isFrozen(c.items[0])).toBe(true);
    expect(Object.isFrozen(c.items)).toBe(true);
  });
});

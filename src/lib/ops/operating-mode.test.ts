import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

process.env.MACROMIRO_DATA_DIR = mkdtempSync(join(tmpdir(), "mode-"));
const m = await import("./operating-mode.ts");
const v2 = await import("../grid/spark-templates.ts");
const here = dirname(fileURLToPath(import.meta.url));

describe("operating mode", () => {
  it("defaults to FULL_STANDBY with no file, and refuses all spend", () => {
    assert.equal(m.readMode().mode, "FULL_STANDBY");
    for (const j of m.SPEND_JOBS) assert.equal(m.spendAllowed(j).ok, false);
  });
  it("garbage or unknown mode files fall back to FULL_STANDBY", () => {
    writeFileSync(m.modePath(), "{not json");
    assert.equal(m.readMode().mode, "FULL_STANDBY");
    writeFileSync(m.modePath(), JSON.stringify({ mode: "TURBO" }));
    assert.equal(m.readMode().mode, "FULL_STANDBY");
  });
  it("LIVE_TRADING cannot be written and a hand-written one reads as FULL_STANDBY", () => {
    assert.throws(() => m.writeMode("LIVE_TRADING", [], "t"));
    writeFileSync(m.modePath(), JSON.stringify({ mode: "LIVE_TRADING", approvedJobs: ["legacy_spark_brief"] }));
    assert.equal(m.readMode().mode, "FULL_STANDBY");
    assert.equal(m.spendAllowed("legacy_spark_brief").ok, false);
  });
  it("MARKET_DATA_ONLY spends nothing; RESEARCH_PAPER spends only approved jobs", () => {
    m.writeMode("MARKET_DATA_ONLY", ["grid_calls"], "t");
    assert.equal(m.spendAllowed("grid_calls").ok, false);
    m.writeMode("RESEARCH_PAPER", ["grid_calls"], "t");
    assert.equal(m.spendAllowed("grid_calls").ok, true);
    assert.equal(m.spendAllowed("legacy_spark_brief").ok, false);
    assert.equal(m.spendAllowed("intel_clerks").ok, false);
  });
  it("persists across a reload (file-backed)", async () => {
    m.writeMode("RESEARCH_PAPER", ["intel_clerks"], "t");
    const again = await import(`./operating-mode.ts?reload=${Date.now()}`);
    assert.deepEqual(again.readMode().approvedJobs, ["intel_clerks"]);
    m.writeMode("FULL_STANDBY", [], "t");
  });
  it("unknown job ids are rejected", () => {
    assert.throws(() => m.writeMode("RESEARCH_PAPER", ["everything"], "t"));
  });
  it("Firecrawl helpers refuse in FULL_STANDBY without calling the network", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-test-not-real";
    const real = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => { called++; return new Response("{}"); }) as unknown as typeof fetch;
    try {
      const fc = await import("../live/firecrawl.server.ts");
      const a = await fc.scrapeArticle("https://www.bls.gov/x");
      const b = await fc.startAgent({});
      const c = await fc.searchWeb("x");
      assert.equal(a.ok, false); assert.equal(b.ok, false); assert.equal(c.ok, false);
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = real;
      delete process.env.FIRECRAWL_API_KEY;
    }
  });
  it("the mode module cannot reach order, risk, gate or probability code", () => {
    const src = readFileSync(resolve(here, "operating-mode.ts"), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual(imports.filter((i) => /order|oms|risk|gate|switch|kalshi|prob|calib/i.test(i)), []);
  });
});

describe("Spark 2 catalyst-investigator/v2", () => {
  const ok = { event_id: "cpi-2026-10", relevant: true, catalyst_type: "macro_release", assets: ["BTC", "GOLD"], source_urls: ["https://www.bls.gov/cpi/"], published_at: "2026-10-14T12:30:00Z", detected_at: "2026-10-14T12:31:00Z", verified_at: "2026-10-14T12:32:00Z", facts: [], uncertainties: [], scenarios: { bullish: "a", bearish: "b", neutral: "c", conditions: [] }, horizon_relevance: { fifteen_minute: "high", reason: "r" }, novelty: "new", uncertainty: "medium", feature_availability: { available_at: "2026-10-14T12:32:00Z", basis: "official" }, credit_usage: { alexandria_providers: [] } };
  it("uses the mission verbatim and carries the decision time", () => {
    const p = v2.catalystPromptV2({ event: "CPI", officialUrls: [], scheduledAt: null, decisionTime: "2026-10-14T12:35:00Z" });
    assert.ok(p.startsWith("You are an evidence-first financial catalyst investigator for AURIX-X."));
    assert.match(p, /Decision time: 2026-10-14T12:35:00Z/);
  });
  it("accepts a valid report", () => assert.equal(v2.validateReportV2(ok, "2026-10-14T12:35:00Z").ok, true));
  it("rejects information from after the decision time (replay leak)", () => {
    const r = v2.validateReportV2(ok, "2026-10-14T12:00:00Z");
    assert.equal(r.ok, false);
  });
  it("rejects probability fields, trade advice and unsupported assets", () => {
    assert.equal(v2.validateReportV2({ ...ok, probability: 0.7 }, "2026-10-15T00:00:00Z").ok, false);
    assert.equal(v2.validateReportV2({ ...ok, scenarios: { bullish: "buy BTC now", bearish: "", neutral: "" } }, "2026-10-15T00:00:00Z").ok, false);
    assert.equal(v2.validateReportV2({ ...ok, assets: ["DOGE"] }, "2026-10-15T00:00:00Z").ok, false);
  });
});

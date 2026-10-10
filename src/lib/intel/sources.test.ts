import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHmac } from "node:crypto";
import { SOURCES, isDue, contentHash, canonicalUrl, normalisePublished, provenance, dedupeFresh, catalystIdForArticle, budgetVerdict, budgetConfig, monthlyCredits } from "./sources.ts";
import { verifyFirecrawlWebhook } from "./webhook-auth.ts";
import { jobKey } from "../research/pipeline.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const src = (id: string) => SOURCES.find((s) => s.id === id)!;

describe("source registry", () => {
  it("every source has a url, topic, destination and a known status", () => {
    const ids = new Set<string>();
    for (const s of SOURCES) {
      assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
      ids.add(s.id);
      assert.match(s.url, /^https:\/\//);
      assert.ok(s.topic && s.destination);
      assert.ok(["VERIFIED", "BROKEN", "PLANNED", "UNUSED", "DUPLICATE"].includes(s.status));
    }
  });
  it("the duplicate Firecrawl monitor is flagged and never scheduled", () => {
    assert.equal(src("fc_monitor_cpi_dup").status, "DUPLICATE");
    assert.equal(isDue(src("fc_monitor_cpi_dup"), {}, NOW), false);
  });
  it("the registry doc lists every source id's site", () => {
    const doc = readFileSync(resolve(dirname(new URL(import.meta.url).pathname), "../../../docs/FIRECRAWL_SOURCE_REGISTRY.md"), "utf8");
    for (const s of SOURCES) assert.ok(doc.includes(s.site), `doc missing ${s.site}`);
  });
});

describe("schedule", () => {
  it("fixed cadence respects everyMin", () => {
    const fed = src("fed_rss");
    assert.equal(isDue(fed, { lastCheckAt: new Date(NOW - 30 * 60_000).toISOString() }, NOW), false);
    assert.equal(isDue(fed, { lastCheckAt: new Date(NOW - 61 * 60_000).toISOString() }, NOW), true);
    assert.equal(isDue(fed, {}, NOW), true);
  });
  it("event cadence only fires inside a release window", () => {
    const rel = src("fc_bls_release");
    assert.equal(isDue(rel, {}, NOW, ["2026-10-14T12:30:00Z"]), true);
    assert.equal(isDue(rel, {}, NOW, ["2026-10-15T12:30:00Z"]), false);
    assert.equal(isDue(rel, {}, NOW, []), false);
    assert.equal(isDue(rel, { lastCheckAt: new Date(NOW - 5 * 60_000).toISOString() }, NOW, ["2026-10-14T12:30:00Z"]), false);
  });
  it("on-demand, planned and unused sources are never auto-scheduled", () => {
    for (const s of SOURCES.filter((x) => x.cadence === "on-demand" || x.status !== "VERIFIED")) assert.equal(isDue(s, {}, NOW, ["2026-10-14T12:30:00Z"]), false, s.id);
  });
});

describe("credit budget", () => {
  it("alerts at 50/80/100% and suspends nonessential paid crawls at the ceiling", () => {
    const cfg = budgetConfig({ FIRECRAWL_MONTHLY_CREDIT_CEILING: "1000" });
    assert.equal(budgetVerdict(400, cfg).alerts.length, 0);
    assert.equal(budgetVerdict(850, cfg).alerts.length, 2);
    const over = budgetVerdict(1000, cfg);
    assert.equal(over.suspendNonessential, true);
    assert.equal(isDue(src("fc_spark_brief"), {}, NOW, [], over.suspendNonessential), false);
    assert.equal(isDue(src("fc_bls_release"), {}, NOW, ["2026-10-14T12:30:00Z"], true), true, "essential release scrape keeps running");
    assert.equal(isDue(src("fed_rss"), {}, NOW, [], true), true, "free RSS is never suspended");
  });
  it("default ceiling applies when unset or invalid", () => {
    assert.equal(budgetConfig({}).monthlyCeiling, 12000);
    assert.equal(budgetConfig({ FIRECRAWL_MONTHLY_CREDIT_CEILING: "abc" }).monthlyCeiling, 12000);
  });
  it("monthly credit maths", () => {
    assert.equal(monthlyCredits(src("fed_rss")), 0);
    assert.equal(monthlyCredits(src("fc_spark_brief"), 90), 36480);
    assert.equal(monthlyCredits(src("fc_spark_brief")), 9120);
  });
});

describe("dedup, timestamps, provenance", () => {
  it("relative and RFC dates normalise; garbage stays null", () => {
    assert.equal(normalisePublished("6 hours ago", NOW), "2026-10-14T06:00:00.000Z");
    assert.equal(normalisePublished("Fri, 09 Oct 2026 18:11:00 +0000", NOW), "2026-10-09T18:11:00.000Z");
    assert.equal(normalisePublished("soon", NOW), null);
  });
  it("tracking params and whitespace do not defeat dedup", () => {
    assert.equal(canonicalUrl("https://www.x.com/a/?utm_source=t#f"), "https://x.com/a");
    assert.equal(contentHash("CPI  Hotter Than Expected"), contentHash("cpi hotter than expected"));
  });
  it("stale and repeated items are dropped", () => {
    const s = src("coindesk_rss");
    const a = provenance(s, { url: "https://www.coindesk.com/a?utm_source=x", title: "BTC jumps", published: "1 hours ago" }, NOW);
    const b = provenance(s, { url: "https://coindesk.com/a", title: "BTC jumps", published: "1 hours ago" }, NOW);
    const old = provenance(s, { url: "https://coindesk.com/o", title: "Old", published: "3 days ago" }, NOW);
    const seen = new Set<string>();
    assert.equal(dedupeFresh([a, b, old], seen, s.freshHours, NOW).length, 1);
    assert.equal(dedupeFresh([a], seen, s.freshHours, NOW).length, 0, "second pass sees nothing new");
    assert.equal(a.note, "untrusted web content: research only, cannot trade");
  });
  it("duplicate articles about one release map to ONE MiroFish job", () => {
    const s = src("gnews_rss");
    const p1 = provenance(s, { url: "https://a.com/cpi", title: "CPI hot", published: "1 hours ago" }, NOW);
    const p2 = provenance(s, { url: "https://b.com/cpi-story", title: "Inflation beats forecasts", published: "1 hours ago" }, NOW);
    const mk = (id: string) => ({ catalyst: { id, kind: "cpi" as const, name: "CPI", when: null, assets: [], sources: [], verified: true }, scenario: "baseline" as const, seed: 1, promptVersion: "v1" });
    const k1 = jobKey(mk(catalystIdForArticle("cpi", "2026-10-14T12:30:00Z", p1)));
    const k2 = jobKey(mk(catalystIdForArticle("cpi", "2026-10-14T12:30:00Z", p2)));
    assert.equal(k1, k2);
  });
});

describe("webhook auth (fail closed)", () => {
  const body = '{"type":"monitor.page"}';
  const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  it("refuses everything when no secret is configured", () => {
    assert.equal(verifyFirecrawlWebhook(body, { signature: sig }, undefined).ok, false);
  });
  it("accepts a valid HMAC or bearer, refuses junk", () => {
    assert.equal(verifyFirecrawlWebhook(body, { signature: sig }, "s3cret").ok, true);
    assert.equal(verifyFirecrawlWebhook(body, { authorization: "Bearer s3cret" }, "s3cret").ok, true);
    assert.equal(verifyFirecrawlWebhook(body, { signature: "sha256=deadbeef" }, "s3cret").ok, false);
    assert.equal(verifyFirecrawlWebhook(body, { signature: "anything" }, "s3cret").ok, false);
    assert.equal(verifyFirecrawlWebhook(body + "x", { signature: sig }, "s3cret").ok, false);
  });
});

describe("web content can never reach orders or probabilities", () => {
  const SRC = resolve(dirname(new URL(import.meta.url).pathname), "../..");
  const files = ["lib/intel/sources.ts", "lib/intel/budget.server.ts", "lib/intel/webhook-auth.ts", "routes/api/firecrawl/webhook.ts", "lib/live/firecrawl.server.ts", "lib/live/spark.server.ts"].map((f) => join(SRC, f));
  it("no source/crawl module imports the order, gate, risk, OMS or probability code", () => {
    for (const f of files) {
      const imports = [...readFileSync(f, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) assert.doesNotMatch(spec, /(order|\/oms|\/gate\b|risk|kalshi|execution|calibrat|edge|desk\/engine)/i, `${f} imports ${spec}`);
      assert.doesNotMatch(readFileSync(f, "utf8"), /placeEventOrder|placePerpOrder|evaluateEdge|createOrder/);
    }
  });
  it("no file under lib/ imports the source registry from order/risk code", () => {
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) out.push(p);
      }
      return out;
    };
    for (const f of walk(join(SRC, "lib"))) {
      if (!/(oms|order|risk|gate|execution|calibrat)/i.test(f)) continue;
      assert.doesNotMatch(readFileSync(f, "utf8"), /intel\/sources|intel\/budget|webhook-auth|firecrawl\.server/, f);
    }
  });
});

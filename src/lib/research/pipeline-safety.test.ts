import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "./alexandria-archive";
import { ACTIVE_STAGES, SCENARIOS, JobStore, drive, estimateCostUsd, extractStructured, jobKey, refreshJobCost, step, TownError, type Deps, type JobSpec, type Stage } from "./pipeline";
import { meterSpent } from "./cost-ledger.server";

const tmp = () => mkdtempSync(join(tmpdir(), "town-safety-"));
const now = Date.parse("2026-11-22T12:00:00Z");
const spec = (over: Partial<JobSpec> = {}): JobSpec => ({
  catalyst: { id: "cpi-test", kind: "cpi", name: "CPI", when: new Date(now + 3 * 86400000).toISOString(), assets: ["BTC"], sources: ["https://www.bls.gov/"], verified: true },
  scenario: "baseline", seed: 1, maxRounds: 3, budgetUsd: 5, catalystBudgetUsd: 20, promptVersion: "test",
  costBasis: { modelVersion: "unknown", priceVersion: "test-only", source: "fixture", agents: 12, inPerM: 0.75, outPerM: 3.75 }, ...over,
});
const report = "# Paid report\n## Structured summary\nLean: bullish, target $68,000 with 80% probability\nCrowding: 68k accounts at 68000.\nContradictions: conflicting narratives\n";
const ok = (data: object) => ({ status: 200, body: { success: true, data } });
const noSleep = async () => undefined;
function setup(stage: Stage = "extract", over: Partial<JobSpec> = {}) {
  const dir = tmp(), store = new JobStore(dir), job = store.create(spec(over), now).job;
  job.stage = stage;
  Object.assign(job.ids, { projectId: "p", simulationId: "s", reportId: "r" });
  job.seed.file = join(dir, "seed.md");
  writeFileSync(job.seed.file, "x".repeat(300));
  store.save(job);
  const archive = new Archive(dir);
  const d: Deps = {
    transport: async () => ok({ status: "completed", markdown_content: report, profiles_count: 12 }),
    seedDir: dir, seeder: async () => ({ text: "x".repeat(300), sources: [{ url: "https://www.bls.gov/", title: "test", fetchedAt: new Date(now).toISOString() }], spark: null }),
    archiver: async (j, md) => archive.archiveJob(j, md, extractStructured(md)), pollMs: 1,
  };
  return { dir, store, job, archive, d };
}

describe("research runner accounting and archive recovery", () => {
  for (const stage of ["ontology", "prepare", "run", "report"] as Stage[]) {
    it(`records costs when ${stage} fails`, async () => {
      const x = setup(stage); let spent = 0;
      if (stage === "report") { x.job.ids.reportId = ""; x.store.save(x.job); }
      x.d.transport = async () => { spent = 0.1234; return { status: 400, body: { success: false, error: "stage failed" } }; };
      x.d.meterSpentUsd = () => spent;
      const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
      expect(done.stage).toBe("failed");
      expect(done.cost.actualUsd).toBe(0.1234);
      expect(done.cost.checkpoints?.[stage]).toBe(0.1234);
      expect(done.result).toBeNull();
    });
  }
  it("meter failure cannot destroy a completed report", async () => {
    const x = setup();
    x.d.meterSpentUsd = () => { throw new Error("private upstream billing payload"); };
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("done");
    expect(done.cost.actualUsd).toBeNull();
    expect(done.cost.meterStatus).toBe("UNAVAILABLE");
    expect(JSON.stringify(done)).not.toContain("private upstream");
    expect(readFileSync(x.archive.all()[0].reportFile!, "utf8")).toBe(report);
  });
  it("a late cost overrun does not block retrieval of an already generated report", async () => {
    const x = setup("report");
    x.d.meterSpentUsd = () => 6;
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("done");
    expect(done.cost.actualUsd).toBe(6);
    expect(x.archive.all()).toHaveLength(1);
  });
  it("cumulative snapshots are not added and unavailable/regressing reads preserve known cost", () => {
    const { job } = setup();
    for (let i = 0; i < 5; i++) refreshJobCost(job, { meterSpentUsd: () => 0.25 });
    expect(job.cost.actualUsd).toBe(0.25);
    refreshJobCost(job, { meterSpentUsd: () => null });
    refreshJobCost(job, { meterSpentUsd: () => 0.1 });
    expect(job.cost.actualUsd).toBe(0.25);
    expect(job.cost.meterStatus).toBe("UNAVAILABLE");
  });
  it("archive is a persisted stage and archive commit followed by lost response is idempotent", async () => {
    const x = setup(); let calls = 0;
    x.d.archiver = async (j, md) => {
      const id = x.archive.archiveJob(j, md, extractStructured(md));
      if (++calls === 1) throw new TownError("lost response after commit", 0, true);
      return id;
    };
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("done");
    expect(x.archive.all()).toHaveLength(1);
    expect(done.history.some(h => h.stage === "archive" && h.note === "extract → archive")).toBe(true);
    expect(ACTIVE_STAGES).toContain("archive");
  });
  it("crash after archive receipt but before job save resumes without another archive call", async () => {
    const x = setup();
    await step(x.job, x.d); x.store.save(x.job);
    const save = x.store.save.bind(x.store); let crashed = false, calls = 0;
    x.store.save = (j, note) => {
      if (j.stage === "archive" && j.pendingReport?.archivedAs && !crashed) { crashed = true; throw new Error("simulated process crash"); }
      save(j, note);
    };
    const archive = x.d.archiver;
    x.d.archiver = async (j, md) => { calls++; return archive(j, md); };
    await expect(drive(x.store, x.job.id, x.d, { sleepFn: noSleep })).rejects.toThrow("simulated process crash");
    x.store.save = save;
    x.d.transport = async () => { throw new Error("backend now unavailable"); };
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("done");
    expect(calls).toBe(1);
    expect(x.archive.all()).toHaveLength(1);
  });
  it("null archive receipt fails visibly and leaves the paid report staged", async () => {
    const x = setup(); x.d.archiver = async () => null;
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("failed");
    expect(done.result).toBeNull();
    expect(readFileSync(done.pendingReport!.file, "utf8")).toBe(report);
  });
  it("corrupt job records are audited and throw instead of silently disappearing", async () => {
    const x = setup();
    writeFileSync(join(x.dir, "jobs", `${x.job.id}.json`), "{torn");
    await expect(drive(x.store, x.job.id, x.d)).rejects.toThrow("unreadable");
    expect(readFileSync(join(x.dir, "jobs-audit.jsonl"), "utf8")).toContain("JOB_RECORD_UNREADABLE");
  });
  it("torn or invalid billing records mark costs unavailable rather than fabricating zero", () => {
    const x = setup(), file = join(x.dir, "usage.jsonl");
    writeFileSync(file, JSON.stringify({ tag: x.job.id, costUsd: 0.2 }) + "\n{torn");
    x.job.cost.actualUsd = 0.1;
    refreshJobCost(x.job, { meterSpentUsd: meterSpent(file) });
    expect(x.job.cost.actualUsd).toBe(0.1);
    expect(x.job.cost.meterStatus).toBe("UNAVAILABLE");
  });
  it("extracts no numeric claims while the raw report stays intact", () => {
    const out = extractStructured(report);
    expect(JSON.stringify(out)).not.toMatch(/68000|68,000|68k|80%|\$68/);
    expect(out.lean).toMatch(/^bullish/);
  });
});

describe("scenario identity, freshness and budget admission", () => {
  it("key includes catalyst, scenario, seed and prompt version", () => {
    const keys = SCENARIOS.map(scenario => jobKey(spec({ scenario })));
    expect(new Set(keys).size).toBe(4);
    expect(jobKey(spec({ seed: 2 }))).not.toBe(keys[0]);
    expect(jobKey(spec({ promptVersion: "new" }))).not.toBe(keys[0]);
    expect(jobKey(spec({ catalyst: { ...spec().catalyst, id: "different-event" } }))).not.toBe(keys[0]);
  });
  it("future-event report expires at release, not a day later", () => {
    const s = new JobStore(tmp()), j = s.create(spec(), now).job;
    j.stage = "done"; s.save(j);
    expect(j.reuseUntil).toBe(j.spec.catalyst.when!);
    expect(s.create(spec(), Date.parse(j.reuseUntil) - 1).created).toBe(false);
    expect(s.create(spec(), Date.parse(j.reuseUntil)).created).toBe(true);
  });
  it("past-event reuse expires at event plus one day, not now plus one day", () => {
    const s = new JobStore(tmp()), when = now - 2 * 86400000;
    const j = s.create(spec({ catalyst: { ...spec().catalyst, when: new Date(when).toISOString() } }), now).job;
    expect(Date.parse(j.reuseUntil)).toBe(when + 86400000);
  });
  it("old pre-event records with the longer legacy TTL cannot be reused after release", () => {
    const s = new JobStore(tmp()), j = s.create(spec(), now).job;
    j.stage = "done";
    j.reuseUntil = new Date(Date.parse(j.spec.catalyst.when!) + 86400000).toISOString();
    s.save(j);
    expect(s.create(spec(), Date.parse(j.spec.catalyst.when!) + 1).created).toBe(true);
  });
  it("enforces aggregate reservations across worlds, seeds and failed attempts", () => {
    const s = new JobStore(tmp());
    const cap = estimateCostUsd(spec()) * 2 + 0.001;
    const a = s.create(spec({ catalystBudgetUsd: cap }), now).job;
    a.stage = "failed"; a.cost.actualUsd = 0.1; s.save(a);
    s.create(spec({ scenario: "bullish", catalystBudgetUsd: cap }), now);
    expect(() => s.create(spec({ scenario: "bearish", catalystBudgetUsd: cap }), now)).toThrow("catalyst budget");
    expect(() => s.create(spec({ seed: 2, catalystBudgetUsd: 100 }), now)).toThrow("catalyst budget");
  });
  it("does not silently assign another model's price assumptions", () => {
    const s = new JobStore(tmp());
    expect(() => s.create(spec(), now, "other-model")).toThrow("mismatched model");
    expect(estimateCostUsd(spec({ costBasis: { ...spec().costBasis!, inPerM: 1.5, outPerM: 7.5 } }))).toBe(2 * estimateCostUsd(spec()));
  });
  it("unknown cost basis prevents a legacy job from spending", async () => {
    const x = setup("ontology", { costBasis: undefined }); let calls = 0;
    x.d.transport = async () => { calls++; return ok({}); };
    const done = await drive(x.store, x.job.id, x.d);
    expect(done.error).toContain("cost basis required");
    expect(done.totalRetries).toBe(1);
    expect(calls).toBe(0);
  });
  it("actual agent count is checked before start, not confused with profile-generation concurrency", async () => {
    const x = setup("run", { budgetUsd: 0.9 }); const calls: string[] = [];
    x.d.transport = async path => { calls.push(path); return ok(path.endsWith("run-status") ? { runner_status: "idle" } : { profiles_count: 500 }); };
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("failed");
    expect(done.progress.agents).toBe(500);
    expect(calls).not.toContain("/api/simulation/start");
  });
  it("unknown backend start state never causes a new POST start", async () => {
    const x = setup("run"), calls: string[] = [];
    x.d.transport = async path => { calls.push(path); return { status: 502, body: { success: false, error: "unavailable" } }; };
    expect((await drive(x.store, x.job.id, x.d, { sleepFn: noSleep })).stage).toBe("failed");
    expect(calls).not.toContain("/api/simulation/start");
  });
});

describe("shutdown, cancellation and deadlines", () => {
  it("a stale worker save cannot overwrite a concurrent cancel", async () => {
    const x = setup("ontology");
    x.store.cancel(x.job.id, "operator");
    x.store.save(x.job); // Snapshot read before the other process cancelled.
    expect(x.store.get(x.job.id)!.cancelRequested).toBe(true);
    let calls = 0; x.d.transport = async () => { calls++; return ok({}); };
    expect((await drive(x.store, x.job.id, x.d)).stage).toBe("cancelled");
    expect(calls).toBe(0);
  });
  it("resuming against a changed configured model cannot spend under the old cost basis", async () => {
    const x = setup("ontology"); x.d.modelVersion = "different-runtime-model";
    let calls = 0; x.d.transport = async () => { calls++; return ok({}); };
    const done = await drive(x.store, x.job.id, x.d);
    expect(done.error).toContain("configured model changed");
    expect(done.totalRetries).toBe(1);
    expect(calls).toBe(0);
  });
  it("env_alive false during active rounds does not kill a healthy simulation", async () => {
    const x = setup("run"), calls: string[] = []; x.job.ids.runStarted = true;
    x.d.transport = async path => { calls.push(path); return ok(path.endsWith("run-status") ? { runner_status: "running", current_round: 1 } : { env_alive: false }); };
    await step(x.job, x.d);
    expect(calls).not.toContain("/api/simulation/stop");
    expect(x.job.stage).toBe("run");
  });
  it("interview-wait shutdown is visible and capped even when backend never acknowledges", async () => {
    const x = setup("run"), calls: string[] = []; x.job.ids.runStarted = true; x.store.save(x.job);
    x.d.transport = async path => { calls.push(path); return ok(path.endsWith("run-status") ? { runner_status: "running", current_round: 3 } : { env_alive: true }); };
    const done = await drive(x.store, x.job.id, x.d, { sleepFn: noSleep });
    expect(done.stage).toBe("failed");
    expect(done.error).toContain("shutdown unconfirmed");
    expect(calls.filter(p => p === "/api/simulation/stop")).toHaveLength(3);
    expect(done.progress.message).toContain("unconfirmed");
  });
  it("operator cancel aborts an in-flight ontology request and still meters it", async () => {
    const x = setup("ontology"); let aborted = false;
    x.d.transport = async (_p, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      setTimeout(() => x.store.cancel(x.job.id, "operator"), 5);
    });
    x.d.meterSpentUsd = () => 0.2;
    const done = await drive(x.store, x.job.id, x.d, { cancelPollMs: 5 });
    expect(aborted).toBe(true);
    expect(done.stage).toBe("cancelled");
    expect(done.cost.actualUsd).toBe(0.2);
    expect(done.result).toBeNull();
  });
  it("restart does not reset the execution deadline", async () => {
    const x = setup("ontology"); x.job.deadlineAt = new Date(Date.now() - 1).toISOString(); x.store.save(x.job);
    let calls = 0; x.d.transport = async () => { calls++; return ok({}); };
    const done = await drive(x.store, x.job.id, x.d, { maxMinutes: 120 });
    expect(done.stage).toBe("failed");
    expect(done.error).toContain("timed out");
    expect(calls).toBe(0);
  });
});

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = mkdtempSync(join(tmpdir(), "miro-test-"));
process.env.MIROFISH_DATA_DIR = DIR;
process.env.MIROFISH_POLL_MS = "100";

const { probabilityFromReport, maxRounds, knockMirofish, miroSnapshot, swarmFeed, readMirofish } = await import("./mirofish.ts");

describe("mirofish report", () => {
  it("reads only an explicitly labeled probability", () => {
    assert.equal(probabilityFromReport("Probability: 62%"), 0.62);
    assert.equal(probabilityFromReport("**Probability:** 0.4"), 0.4);
    assert.equal(probabilityFromReport("Swarm probability (continuation): 55 %"), 0.55);
    assert.equal(probabilityFromReport("volume up 80%\n...\nProbability: 30%"), 0.3);
    assert.equal(probabilityFromReport("Probability: 12%\nlater\nProbability: 41%"), 0.41);
    assert.equal(probabilityFromReport("概率：70%"), 0.7);
  });

  it("refuses unlabeled, out-of-range, or unknown numbers", () => {
    assert.equal(probabilityFromReport("crowd continues in 80% of runs"), null);
    assert.equal(probabilityFromReport("p = 0.42 after the print"), null);
    assert.equal(probabilityFromReport("Probability: 150%"), null);
    assert.equal(probabilityFromReport("Probability: 62"), null);
    assert.equal(probabilityFromReport("Probability: unknown"), null);
    assert.equal(probabilityFromReport("no figure in this note"), null);
  });

  it("caps rounds at 40 and defaults to 15", () => {
    assert.equal(maxRounds(undefined), 15);
    assert.equal(maxRounds("10"), 10);
    assert.equal(maxRounds("400"), 40);
    assert.equal(maxRounds("-3"), 15);
    assert.equal(maxRounds("junk"), 15);
  });
});

describe("one knock walks every stage on its own", () => {
  let server: Server;
  const seen: string[] = [];
  let startBody: Record<string, unknown> = {};
  let runPolls = 0;

  before(async () => {
    writeFileSync(join(DIR, "spark-latest.json"), JSON.stringify({ card: { event: "Test print" } }));
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const url = req.url ?? "";
        seen.push(`${req.method} ${url.split("?")[0]}`);
        const ok = (data: unknown) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true, data }));
        };
        if (url === "/api/graph/ontology/generate") return ok({ project_id: "proj_1" });
        if (url === "/api/graph/build") return ok({ project_id: "proj_1", task_id: "task_g" });
        if (url === "/api/graph/task/task_g") return ok({ status: "completed", progress: 100, result: { graph_id: "g1" } });
        if (url === "/api/simulation/create") return ok({ simulation_id: "sim_1" });
        if (url === "/api/simulation/prepare") return ok({ task_id: "task_p", already_prepared: false });
        if (url === "/api/simulation/prepare/status") return ok({ status: "ready", progress: 100 });
        if (url === "/api/simulation/start") {
          startBody = JSON.parse(raw || "{}");
          return ok({ runner_status: "running", max_rounds_applied: startBody.max_rounds });
        }
        if (url === "/api/simulation/sim_1/run-status") {
          if (!startBody.simulation_id) return ok({ runner_status: "idle" });
          runPolls += 1;
          return ok({ runner_status: runPolls >= 2 ? "completed" : "running", current_round: runPolls * 5, total_rounds: 10, total_actions_count: 7 });
        }
        if (url === "/api/simulation/env-status") return ok({ env_alive: false });
        if (url.startsWith("/api/simulation/sim_1/actions")) return ok({ count: 1, actions: [{ round_num: 1, platform: "twitter", agent_id: 3, agent_name: "Ann", action_type: "CREATE_POST", action_args: { content: "gold up" }, success: true }] });
        if (url === "/api/simulation/sim_1/timeline") return ok({ timeline: [{ round_num: 1, twitter_actions: 1, reddit_actions: 0, active_agents_count: 1, action_types: { CREATE_POST: 1 } }] });
        if (url === "/api/report/generate") return ok({ report_id: "rep_1", task_id: "task_r" });
        if (url === "/api/report/generate/status") return ok({ status: "completed", progress: 100, report_id: "rep_1" });
        if (url === "/api/report/rep_1") return ok({ markdown_content: "Agents posted 80% bullish.\n\nProbability: 64%" });
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "not found" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    process.env.MIROFISH_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    process.env.MIROFISH_MAX_ROUNDS = "99";
  });

  after(() => server.close());

  it("returns at once, then reaches done with the labeled probability and max_rounds <= 40", async () => {
    const t0 = Date.now();
    const out = knockMirofish();
    assert.equal(out.started, true);
    assert.ok(Date.now() - t0 < 200, "knock must not wait on the town");
    const second = knockMirofish();
    assert.equal(second.started, false, "a knock in flight is not doubled");
    const deadline = Date.now() + 15_000;
    while (miroSnapshot().running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const snap = miroSnapshot();
    assert.equal(snap.stage, "done", snap.error);
    assert.equal(snap.probability, 0.64);
    assert.equal(startBody.max_rounds, 40);
    assert.equal(startBody.platform, "twitter");
    assert.equal(seen.filter((s) => s === "POST /api/simulation/start").length, 1, "start exactly once");
    assert.ok(seen.includes("POST /api/simulation/prepare/status"));
    assert.ok(seen.includes("POST /api/report/generate/status"));
    assert.equal(readMirofish()?.probability, 0.64);
    const state = JSON.parse(readFileSync(join(DIR, "mirofish-state.json"), "utf8"));
    assert.equal(state.simulationId, "sim_1");
    const again = knockMirofish();
    assert.equal(again.started, false, "same headline is reused instead of spending again");
  });

  it("relays the live agent feed read-only", async () => {
    const feed = await swarmFeed(10);
    assert.equal(feed.sendsOrders, false);
    assert.equal(feed.actions[0]?.agent, "Ann");
    assert.equal(feed.actions[0]?.text, "gold up");
    assert.equal(feed.timeline[0]?.actions, 1);
  });

  it("a down town is an error with a null probability, not a guess", async () => {
    server.close();
    process.env.MIROFISH_URL = "http://127.0.0.1:9";
    writeFileSync(join(DIR, "spark-latest.json"), JSON.stringify({ card: { event: "Another print" } }));
    process.env.MIROFISH_MAX_MINUTES = "5";
    const out = knockMirofish();
    assert.equal(out.started, true);
    await new Promise((r) => setTimeout(r, 400));
    const snap = miroSnapshot();
    assert.equal(snap.probability, null);
    assert.match(snap.error, /not answering|retry/);
  });
});

describe("a finished round loop that never logs simulation_end is closed, then reported", () => {
  let server: Server;
  let stopped = false;
  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "miro-test2-"));
    process.env.MIROFISH_DATA_DIR = dir;
    writeFileSync(join(dir, "spark-latest.json"), JSON.stringify({ card: { event: "Idle env print" } }));
    writeFileSync(
      join(dir, "mirofish-state.json"),
      JSON.stringify({ knockId: "kx", headline: "Idle env print", stage: "run", projectId: "p", graphId: "g", simulationId: "sim_2", runStarted: true, maxRounds: 15, startedAt: Date.now() }),
    );
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        const url = req.url ?? "";
        const ok = (data: unknown) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true, data }));
        };
        if (url === "/api/simulation/sim_2/run-status") return ok({ runner_status: stopped ? "stopped" : "running", current_round: 0, total_rounds: 15 });
        if (url === "/api/simulation/env-status") return ok({ env_alive: true });
        if (url === "/api/simulation/stop") {
          stopped = true;
          return ok({ runner_status: "stopped" });
        }
        if (url === "/api/report/generate") return ok({ report_id: "rep_2", already_generated: true });
        if (url === "/api/report/rep_2") return ok({ markdown_content: "Probability: unknown" });
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "not found" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    process.env.MIROFISH_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  after(() => server.close());

  it("resumes a persisted run, stops the idle env, and keeps probability null when the report has none", async () => {
    const { resumeMirofish } = await import("./mirofish.ts");
    resumeMirofish();
    const deadline = Date.now() + 10_000;
    while (miroSnapshot().running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    const snap = miroSnapshot();
    assert.equal(stopped, true);
    assert.equal(snap.stage, "done", snap.error);
    assert.equal(snap.probability, null);
  });
});

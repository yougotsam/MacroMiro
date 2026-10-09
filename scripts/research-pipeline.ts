/**
 * Event-driven research pipeline CLI (no orders, no Kalshi, no probabilities for the desk).
 *   bun scripts/research-pipeline.ts plan [--hours 120] [--seeds 1] [--rounds 5] [--day-budget 3]   (dry: cost plan)
 *   bun scripts/research-pipeline.ts enqueue --kind cpi --scenario baseline --seed 1 --rounds 3 --budget 0.9
 *   bun scripts/research-pipeline.ts run            resume/drive queued+active jobs one at a time (pid lock)
 *   bun scripts/research-pipeline.ts status | cancel <jobId> --reason "<why>" | dashboard
 * Data: /workspace/data/research (jobs/, jobs-audit.jsonl, seeds/, alexandria-archive.jsonl, reports/, dashboard.json)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Archive, incrementalValue, matchOutcomes, type IndexPoint } from "../src/lib/research/alexandria-archive";
import { ACTIVE_STAGES, JobStore, PROMPT_VERSION, SCENARIOS, drive, estimateCostUsd, extractStructured, type JobSpec, type Scenario } from "../src/lib/research/pipeline";
import { catalystsFromCalendar, firecrawlSeeder, meterSpent, mirofishTransport } from "../src/lib/research/pipeline.server";
import { officialCalendarPath, type OfficialCalendar } from "../src/lib/desk/official-calendar";

const DIR = process.env.RESEARCH_DIR || "/workspace/data/research";
mkdirSync(DIR, { recursive: true });
const args = process.argv.slice(2);
const cmd = args[0] ?? "status";
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const store = new JobStore(DIR);
const archive = new Archive(DIR);
const MODEL_VERSION = (() => {
  let llm = "unknown";
  try { llm = readFileSync("/workspace/desk/MiroFish/.env", "utf8").match(/^LLM_MODEL_NAME=(.+)$/m)?.[1]?.trim() ?? "unknown"; } catch { /* unreadable */ }
  return `mirofish@${process.env.MIROFISH_COMMIT ?? "local"}+${llm}+${PROMPT_VERSION}`;
})();
const cal = (): OfficialCalendar | null => { try { return JSON.parse(readFileSync(officialCalendarPath(), "utf8")) as OfficialCalendar; } catch { return null; } };

function deps() {
  return {
    transport: mirofishTransport(), seeder: firecrawlSeeder, seedDir: join(DIR, "seeds"), pollMs: 5000, meterSpentUsd: meterSpent(join(DIR, "llm-usage.jsonl")),
    archiver: async (job: Parameters<Archive["archiveJob"]>[0], md: string) => archive.archiveJob(job, md, extractStructured(md)),
  };
}

function specFor(kind: string, scenario: Scenario, seed: number, rounds: number, budget: number, hours = 24 * 30): JobSpec {
  const c = cal();
  const cats = c ? catalystsFromCalendar(c, Date.now(), hours * 3600_000) : [];
  const catalyst = cats.find((x) => x.kind === kind);
  if (!catalyst) throw new Error(`no verified upcoming ${kind} event in the official calendar`);
  return { catalyst, scenario, seed, maxRounds: rounds, budgetUsd: budget, promptVersion: PROMPT_VERSION };
}

if (cmd === "plan") {
  const hours = Number(opt("--hours", "120")), seeds = Number(opt("--seeds", "1")), rounds = Number(opt("--rounds", "5")), dayBudget = Number(opt("--day-budget", "3"));
  const c = cal();
  const cats = c ? catalystsFromCalendar(c, Date.now(), hours * 3600_000) : [];
  const plan = cats.flatMap((catalyst) => SCENARIOS.flatMap((scenario) => Array.from({ length: seeds }, (_, i) => ({ catalyst: catalyst.id, when: catalyst.when, scenario, seed: i + 1, rounds, estUsd: estimateCostUsd({ maxRounds: rounds }) }))));
  const total = plan.reduce((a, p) => a + p.estUsd, 0);
  console.log(JSON.stringify({ catalysts: cats.map((x) => ({ id: x.id, name: x.name, when: x.when })), jobs: plan.length, estimatedTotalUsd: Number(total.toFixed(2)), dayBudgetUsd: dayBudget, withinBudget: total <= dayBudget, note: "dry plan; enqueue needs owner approval above the ~$1 smoke limit" }, null, 1));
} else if (cmd === "enqueue") {
  const spec = specFor(opt("--kind", "cpi"), opt("--scenario", "baseline") as Scenario, Number(opt("--seed", "1")), Number(opt("--rounds", "3")), Number(opt("--budget", "0.9")));
  console.log(JSON.stringify(store.create(spec, Date.now(), MODEL_VERSION), (k, v) => (k === "history" ? undefined : v), 1));
} else if (cmd === "run") {
  const lock = join(DIR, "runner.pid");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try { process.kill(pid, 0); console.error(`runner already running (pid ${pid})`); process.exit(1); } catch { /* stale lock */ }
  }
  writeFileSync(lock, String(process.pid));
  const release = () => { try { unlinkSync(lock); } catch { /* gone */ } };
  process.on("SIGTERM", () => { release(); process.exit(0); });
  try {
    for (;;) {
      const next = store.list().find((j) => (ACTIVE_STAGES as readonly string[]).includes(j.stage));
      if (!next) break;
      writeFileSync(join(DIR, "meter-tag"), next.id); // attribute LLM spend to this job
      const done = await drive(store, next.id, deps(), { maxMinutes: Number(opt("--max-minutes", "90")) });
      console.log(new Date().toISOString(), next.id, done?.stage, done?.error ?? "", JSON.stringify(done?.ids ?? {}));
      if (args.includes("--one")) break;
    }
  } finally { release(); }
} else if (cmd === "cancel") {
  console.log(JSON.stringify(store.cancel(args[1], opt("--reason", "operator cancel"))?.stage ?? "not found"));
} else if (cmd === "status") {
  for (const j of store.list()) console.log(j.id, j.stage, j.spec.catalyst.id, j.spec.scenario, `seed=${j.spec.seed}`, `est=$${j.cost.estimatedUsd}`, `actual=${j.cost.actualUsd ?? "n/a"}`, j.error ?? "", JSON.stringify(j.ids));
} else if (cmd === "dashboard") {
  // official index observations from the read-only collector, for after-the-fact matching
  const obsDir = process.env.DESK_OBSERVE_DIR || "/workspace/data/desk-observe";
  const index = new Map<string, IndexPoint[]>();
  if (existsSync(obsDir)) for (const f of readdirSync(obsDir).filter((x) => x.startsWith("observations-"))) {
    for (const l of readFileSync(join(obsDir, f), "utf8").split("\n")) {
      if (!l) continue;
      try {
        const r = JSON.parse(l) as { series?: string; ts?: string; index?: { value?: number } };
        if (r.series && r.ts && typeof r.index?.value === "number") index.set(r.series, [...(index.get(r.series) ?? []), { ms: Date.parse(r.ts), value: r.index.value }]);
      } catch { /* torn */ }
    }
  }
  const items = archive.all();
  const matches = matchOutcomes(items, index);
  let analysis: unknown = null;
  try { analysis = JSON.parse(readFileSync(join(obsDir, "analysis-latest.json"), "utf8")); } catch { analysis = null; }
  const dash = {
    generatedAt: new Date().toISOString(),
    scenarios: {
      label: "SIMULATED SCENARIOS — narrative context only. Simulated agents are not real order flow. Not probabilities. Cannot authorize trades.",
      jobs: store.list().map((j) => ({ id: j.id, stage: j.stage, catalyst: j.spec.catalyst, scenario: j.spec.scenario, seed: j.spec.seed, rounds: j.spec.maxRounds, ids: j.ids, extracted: j.result?.extracted ?? null, error: j.error, cost: j.cost, createdAt: j.createdAt, updatedAt: j.updatedAt })),
      archive: { items: items.length, matches: matches.length, incremental: incrementalValue(matches) },
    },
    calibratedProbabilities: {
      label: "CALIBRATED PROBABILITIES — settlement model only. None approved (no owner-signed calibrator).",
      milestone: (analysis as { milestone?: unknown } | null)?.milestone ?? null,
      collector: (analysis as { collector?: unknown } | null)?.collector ?? null,
      calendar: (analysis as { calendar?: unknown } | null)?.calendar ?? null,
    },
  };
  writeFileSync(join(DIR, "dashboard.json"), JSON.stringify(dash, null, 1));
  console.log(`wrote ${join(DIR, "dashboard.json")} (${dash.scenarios.jobs.length} jobs, ${items.length} archived)`);
}

/**
 * Server-side operating mode for RESEARCH spend. Persisted in <DATA_ROOT>/operating-mode.json so it survives
 * restarts and reconnects. Missing, unreadable or unknown → FULL_STANDBY (the default for unapproved research).
 *
 *  FULL_STANDBY      no new Firecrawl spend: no scrapes/searches/agents/monitor creation, remote monitors paused.
 *  MARKET_DATA_ONLY  same Firecrawl rule; only the free Kalshi collector and free official calendars run.
 *  RESEARCH_PAPER    only jobs listed in `approvedJobs` may spend, under the monthly ceiling; orders stay locked.
 *  LIVE_TRADING      not available from here; treated as FULL_STANDBY.
 *
 * This gate only ever REMOVES research activity. It has no path to orders, risk, the gate or probabilities.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

export const MODES = ["FULL_STANDBY", "MARKET_DATA_ONLY", "RESEARCH_PAPER", "LIVE_TRADING"] as const;
export type Mode = (typeof MODES)[number];
export type ModeFile = { mode: Mode; approvedJobs: string[]; setBy: string; setAt: string; note?: string };

/** Every job that can spend Firecrawl credits. Ids are what `approvedJobs` lists. */
export const SPEND_JOBS = ["legacy_spark_brief", "intel_clerks", "radar_official_scrape", "news_search", "article_scrape", "grid_calls", "grid_monitors", "calendar_monitors", "mirofish_seeding"] as const;
export type SpendJob = (typeof SPEND_JOBS)[number];

export const modePath = () => `${DATA_ROOT}/operating-mode.json`;

export function readMode(): ModeFile {
  try {
    const m = JSON.parse(readFileSync(modePath(), "utf8")) as Partial<ModeFile>;
    if (!m.mode || !MODES.includes(m.mode)) throw new Error("bad mode");
    const mode: Mode = m.mode === "LIVE_TRADING" ? "FULL_STANDBY" : m.mode;
    return { mode, approvedJobs: Array.isArray(m.approvedJobs) ? m.approvedJobs.filter((j) => (SPEND_JOBS as readonly string[]).includes(j)) : [], setBy: String(m.setBy ?? "?"), setAt: String(m.setAt ?? ""), ...(m.mode === "LIVE_TRADING" ? { note: "LIVE_TRADING is not available; running FULL_STANDBY" } : {}) };
  } catch {
    return { mode: "FULL_STANDBY", approvedJobs: [], setBy: "default", setAt: "", note: "no valid mode file: default FULL_STANDBY" };
  }
}

export function writeMode(mode: Mode, approvedJobs: string[], setBy: string): ModeFile {
  if (mode === "LIVE_TRADING") throw new Error("LIVE_TRADING is not available from the research mode switch");
  const bad = approvedJobs.filter((j) => !(SPEND_JOBS as readonly string[]).includes(j));
  if (bad.length) throw new Error(`unknown job(s): ${bad.join(", ")}`);
  const row: ModeFile = { mode, approvedJobs: mode === "RESEARCH_PAPER" ? approvedJobs : [], setBy, setAt: new Date().toISOString() };
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(`${modePath()}.tmp`, JSON.stringify(row, null, 1));
  renameSync(`${modePath()}.tmp`, modePath());
  return row;
}

/** May this job spend Firecrawl credits right now? */
export function spendAllowed(job: SpendJob): { ok: boolean; reason: string } {
  const m = readMode();
  if (m.mode !== "RESEARCH_PAPER") return { ok: false, reason: `operating mode ${m.mode}: no Firecrawl spend` };
  if (!m.approvedJobs.includes(job)) return { ok: false, reason: `job ${job} not approved in RESEARCH_PAPER` };
  return { ok: true, reason: "approved" };
}

/**
 * Machine-readable schemas for the loop (Loop Engineering PDF primitives): lessons, retros, incidents (SRE-style),
 * run outcomes, and skill files (goal / rules / lessons / regime tags). Validators are strict and dependency-free.
 */
export type Regime = "trend_up" | "trend_down" | "range" | "high_vol" | "low_vol" | "event" | "any";
export const REGIMES: Regime[] = ["trend_up", "trend_down", "range", "high_vol", "low_vol", "event", "any"];

export type Lesson = {
  id: string; at: string; source: string; scope: "kalshi15m" | "perps" | "all";
  rule: string; evidence: string; regime: Regime[];
  status: "active" | "pending" | "rejected";
  approvedBy: "checker" | "owner" | "seed" | null;
};
export type Retro = { at: string; tradeId: string; role: "maker" | "checker"; line: string; proposedRule?: string };
export type Severity = "SEV1" | "SEV2" | "SEV3";
export type Incident = {
  id: string; at: string; severity: Severity; source: "watchdog" | "engine" | "checker" | "operator";
  summary: string; impact: string; detection: string; action: string; status: "open" | "mitigated" | "resolved";
  timeline: { at: string; what: string }[]; followUps: string[];
};
export type RunOutcome = { at: string; runId: string; engine: string; maker: string; trades: number; netUsd: number; aiCostUsd: number; stopReason: string; lessonsLoaded: number };
export type SkillFile = { name: string; goal: string; rules: string[]; lessons: string[]; regimeTags: Regime[]; version: string };

const str = (x: unknown) => typeof x === "string" && x.length > 0;
export function validLesson(x: Partial<Lesson>): string | null {
  if (!str(x.id) || !str(x.at) || !str(x.rule) || !str(x.evidence) || !str(x.source)) return "lesson needs id, at, source, rule, evidence";
  if (!["kalshi15m", "perps", "all"].includes(String(x.scope))) return "bad scope";
  if (!Array.isArray(x.regime) || !x.regime.every((r) => REGIMES.includes(r))) return "bad regime tags";
  if (!["active", "pending", "rejected"].includes(String(x.status))) return "bad status";
  if (x.status === "active" && !x.approvedBy) return "active lesson needs an approver (checker/owner/seed)";
  return null;
}
export function validIncident(x: Partial<Incident>): string | null {
  if (!str(x.id) || !str(x.at) || !str(x.summary) || !str(x.impact) || !str(x.detection) || !str(x.action)) return "incident needs id, at, summary, impact, detection, action";
  if (!["SEV1", "SEV2", "SEV3"].includes(String(x.severity))) return "bad severity";
  if (!Array.isArray(x.timeline) || !Array.isArray(x.followUps)) return "timeline/followUps must be arrays";
  return null;
}
export function validSkill(x: Partial<SkillFile>): string | null {
  if (!str(x.name) || !str(x.goal) || !str(x.version)) return "skill needs name, goal, version";
  if (!Array.isArray(x.rules) || !x.rules.length) return "skill needs at least one rule";
  if (!Array.isArray(x.lessons)) return "lessons must be an array";
  if (!Array.isArray(x.regimeTags) || !x.regimeTags.length || !x.regimeTags.every((r) => REGIMES.includes(r))) return "bad regime tags";
  return null;
}
/** Parse a skill markdown file with "## Goal / ## Rules / ## Lessons / ## Regime tags" sections. */
export function parseSkillMd(name: string, md: string, version = "1"): SkillFile {
  const sec = (h: string) => (md.split(new RegExp(`^##\\s+${h}\\s*$`, "im"))[1] ?? "").split(/^##\s+/m)[0];
  const items = (s: string) => s.split("\n").map((l) => l.replace(/^\s*[-*]\s+/, "").trim()).filter((l) => l && !l.startsWith("#"));
  return { name, goal: items(sec("Goal")).join(" "), rules: items(sec("Rules")), lessons: items(sec("Lessons")), regimeTags: items(sec("Regime tags")).flatMap((l) => l.split(/[,\s]+/)).filter(Boolean) as Regime[], version };
}

/**
 * Loop memory (Loop Engineering PDF: STATE.md + lessons). Machine-readable: state.json is the source of truth and
 * STATE.md is rendered from it (plus an append-only incident section). lessons.jsonl holds ACTIVE/REJECTED rules;
 * pending-lessons.jsonl is the queue of proposed rules — nothing becomes active without checker or owner approval.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loopDir, P } from "./paths";
import { validIncident, validLesson, type Incident, type Lesson, type Retro, type RunOutcome } from "./schema";

export type LoopState = { updatedAt: string; lastRun: RunOutcome | null; runs: number; openIncidents: string[]; notes: string[] };

const ensure = () => mkdirSync(loopDir(), { recursive: true });
export function readJsonl<T>(f: string): T[] {
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as T]; } catch { return []; } });
}
const append = (f: string, x: unknown) => { ensure(); appendFileSync(f, JSON.stringify(x) + "\n"); };

export function readState(): LoopState {
  try { return JSON.parse(readFileSync(P.stateJson(), "utf8")) as LoopState; }
  catch { return { updatedAt: new Date(0).toISOString(), lastRun: null, runs: 0, openIncidents: [], notes: [] }; }
}

/** Latest record per lesson id wins (append-only log). */
export function allLessons(): Lesson[] {
  const m = new Map<string, Lesson>();
  for (const l of readJsonl<Lesson>(P.lessons())) m.set(l.id, l);
  return [...m.values()];
}
export const activeLessons = (scope?: Lesson["scope"]) => allLessons().filter((l) => l.status === "active" && (!scope || l.scope === scope || l.scope === "all"));
export const pendingLessons = () => {
  const decided = new Set(allLessons().map((l) => l.id));
  return readJsonl<Lesson>(P.pending()).filter((l) => !decided.has(l.id));
};

export function addSeedLesson(l: Omit<Lesson, "status" | "approvedBy">) {
  const x: Lesson = { ...l, status: "active", approvedBy: "seed" };
  const e = validLesson(x); if (e) throw new Error(e);
  if (allLessons().some((y) => y.id === x.id)) return false;
  append(P.lessons(), x); return true;
}
/** Proposed rules only ever enter the pending queue. */
export function proposeLesson(l: Omit<Lesson, "status" | "approvedBy">) {
  const x: Lesson = { ...l, status: "pending", approvedBy: null };
  const e = validLesson(x); if (e) throw new Error(e);
  if (pendingLessons().some((y) => y.id === x.id) || allLessons().some((y) => y.id === x.id)) return false;
  append(P.pending(), x); return true;
}
/** Only the checker (or the owner) can promote a pending lesson. The maker cannot. */
export function decideLesson(id: string, by: "checker" | "owner" | "maker", approve: boolean) {
  if (by === "maker") throw new Error("maker cannot approve its own lessons");
  const p = pendingLessons().find((l) => l.id === id); if (!p) throw new Error(`no pending lesson ${id}`);
  const x: Lesson = { ...p, at: new Date().toISOString(), status: approve ? "active" : "rejected", approvedBy: by };
  append(P.lessons(), x); return x;
}

/** After every closed paper trade: maker and checker each write one line. A proposed rule goes to the pending queue. */
export function writeRetro(r: Retro) {
  if (!r.line || r.line.includes("\n") || r.line.length > 280) throw new Error("retro must be one line ≤ 280 chars");
  append(P.retros(), r);
  if (r.proposedRule) proposeLesson({ id: `retro-${r.tradeId}-${r.role}`, at: r.at, source: `retro:${r.role}`, scope: "all", rule: r.proposedRule, evidence: `trade ${r.tradeId}: ${r.line}`, regime: ["any"] });
}

/** Called at the start of every run: returns the active lessons the engine/maker must respect. */
export function beginRun(scope: Lesson["scope"]) {
  const lessons = activeLessons(scope);
  return { lessons, runId: `run-${Date.now().toString(36)}`, startedAt: new Date().toISOString() };
}
/** Called at the end of every run: persists the outcome and re-renders STATE.md. */
export function endRun(o: RunOutcome) {
  append(P.runs(), o);
  const s = readState();
  writeState({ ...s, lastRun: o, runs: s.runs + 1 });
}

export function appendIncident(i: Incident) {
  const e = validIncident(i); if (e) throw new Error(e);
  append(P.incidents(), i);
  const s = readState();
  writeState({ ...s, openIncidents: i.status === "resolved" ? s.openIncidents.filter((x) => x !== i.id) : [...new Set([...s.openIncidents, i.id])] });
}

export function writeState(s: LoopState) {
  ensure();
  s = { ...s, updatedAt: new Date().toISOString() };
  writeFileSync(P.stateJson(), JSON.stringify(s, null, 1));
  writeFileSync(P.state(), renderState(s));
}

export function renderState(s: LoopState) {
  const act = activeLessons(), pend = pendingLessons(), inc = readJsonl<Incident>(P.incidents()).slice(-10);
  const L = [
    "# STATE.md — MacroMiro loop memory (generated from state.json; do not hand-edit)", "",
    `updatedAt: ${s.updatedAt}`, `runs: ${s.runs}`, `openIncidents: ${s.openIncidents.join(", ") || "none"}`, "",
    "## Last run", s.lastRun ? "```json\n" + JSON.stringify(s.lastRun) + "\n```" : "none yet", "",
    `## Active lessons (${act.length}) — loaded at the start of every run`, ...act.map((l) => `- [${l.id}] (${l.scope}; ${l.regime.join(",")}; by ${l.approvedBy}) ${l.rule}`), "",
    `## Pending lessons (${pend.length}) — NOT applied until the checker or owner approves`, ...pend.map((l) => `- [${l.id}] ${l.rule}`), "",
    "## Recent incidents", ...inc.map((i) => `- ${i.at} ${i.severity} ${i.id}: ${i.summary} → ${i.action} (${i.status})`), "",
    "## Notes", ...s.notes.map((n) => `- ${n}`), "",
  ];
  return L.join("\n");
}

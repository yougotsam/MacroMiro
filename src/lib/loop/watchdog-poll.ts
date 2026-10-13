/**
 * One watchdog poll (paper). Reads ONLY files: Kalshi paper portfolio (paper/paper-latest.json) and the perps paper
 * account (perps/paper-account.json, if it exists). On breach it calls the EXISTING kill paths:
 *  - Kalshi 15m: writes loop/paper-kill.json; the paper replay (paper/portfolio.ts) flattens open paper positions
 *    at mark once the −$15 day stop is hit, and refuses new entries while the kill file is for today.
 *  - Perps: PerpsOms.killAndFlatten against an in-memory PAPER exchange seeded from the paper account (never the
 *    venue; this module imports no real transport), then writes the flattened account back.
 * Every breach appends an SRE-style incident to STATE.md.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import { FakeExchange, PerpsOms } from "@/lib/perps/oms";
import { appendIncident } from "./state";
import { P } from "./paths";
import { kalshiStop, perpsDrawdown, ddLimitPct, type WatchResult } from "./watchdog";

const root = () => process.env.MACROMIRO_DATA_DIR || DATA_ROOT;
const etDay = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
export type PaperAccount = { equityUsd: number; peakUsd: number; positions: Record<string, { q: number; e: number }>; books?: Record<string, { bestBid: number | null; bestAsk: number | null }> };
const readJson = <T>(f: string): T | null => { try { return JSON.parse(readFileSync(f, "utf8")) as T; } catch { return null; } };

export async function pollOnce(now = Date.now()): Promise<WatchResult> {
  const actions: string[] = [];
  // ---- Kalshi 15m paper: worst config today (the stop is per config/portfolio) ----
  const paper = readJson<{ configs?: { id: string; portfolio?: { todayRealizedUsd: number; openExposureUsd: number } }[] }>(`${root()}/paper/paper-latest.json`);
  const ports = (paper?.configs ?? []).filter((c) => c.portfolio);
  const worst = ports.reduce<{ id: string; r: number; o: number } | null>((w, c) => (!w || c.portfolio!.todayRealizedUsd < w.r ? { id: c.id, r: c.portfolio!.todayRealizedUsd, o: c.portfolio!.openExposureUsd } : w), null);
  const k = kalshiStop(worst?.r ?? 0, worst?.o ?? 0);
  if (k.breached) {
    const breachedIds = ports.filter((c) => kalshiStop(c.portfolio!.todayRealizedUsd, 0).breached).map((c) => c.id);
    const prev = readJson<{ day: string; configs: string[] }>(P.paperKill());
    const fresh = !prev || prev.day !== etDay(now) || breachedIds.some((x) => !prev.configs.includes(x));
    writeFileSync(P.paperKill(), JSON.stringify({ day: etDay(now), at: new Date(now).toISOString(), reason: `Kalshi 15m day stop ${k.stopUsd} reached`, configs: breachedIds, action: "flatten open paper positions at mark; refuse new entries for the ET day" }));
    actions.push(`kalshi paper kill: ${breachedIds.join(",")}`);
    if (fresh) appendIncident({ id: `inc-kalshi-stop-${etDay(now)}`, at: new Date(now).toISOString(), severity: "SEV2", source: "watchdog", summary: `Kalshi 15m paper day stop reached (${breachedIds.join(", ")})`, impact: `worst config ${worst?.id} realized ${k.dayRealizedUsd} USD today (paper)`, detection: "risk watchdog poll", action: "paper-kill.json written; open paper positions flattened at mark; new entries refused for the ET day", status: "mitigated", timeline: [{ at: new Date(now).toISOString(), what: "breach detected and kill written" }], followUps: ["owner review", "post-mortem if repeated"] });
  }
  // ---- Perps paper ----
  const accF = `${root()}/perps/paper-account.json`;
  const acc = existsSync(accF) ? readJson<PaperAccount>(accF) : null;
  const dd = perpsDrawdown(acc?.equityUsd ?? null, acc?.peakUsd ?? null);
  const open = acc ? Object.values(acc.positions).filter((p) => p.q !== 0).length : 0;
  if (acc && dd.breached && open > 0) {
    const fx = new FakeExchange(); for (const [t, p] of Object.entries(acc.positions)) fx.pos.set(t, { ...p });
    const oms = new PerpsOms(fx, `${root()}/perps/paper-oms-journal.jsonl`, false);
    const tok = `watchdog-${now}`;
    const r = await oms.killAndFlatten(tok, tok, acc.books ?? {}, `watchdog-dd-${now}`);
    const after = Object.fromEntries((await fx.positions()).map((p) => [p.market_ticker, { q: Number(p.position), e: Number(p.entry_price) }]));
    writeFileSync(accF, JSON.stringify({ ...acc, positions: after, killedAt: new Date(now).toISOString() }));
    actions.push(`perps paper killAndFlatten: ${"actions" in r ? r.actions?.join("; ") : r.why}`);
    appendIncident({ id: `inc-perps-dd-${now}`, at: new Date(now).toISOString(), severity: "SEV1", source: "watchdog", summary: `Perps paper drawdown ${dd.ddPct}% ≥ limit ${ddLimitPct()}% (PENDING OWNER DECISION default)`, impact: `equity ${acc.equityUsd} vs peak ${acc.peakUsd} (paper)`, detection: "risk watchdog poll", action: "PerpsOms.killAndFlatten on paper exchange (cancel-all + reduce-only flatten)", status: "mitigated", timeline: [{ at: new Date(now).toISOString(), what: "breach detected; flatten sent to paper exchange" }], followUps: ["owner to set the hard drawdown number"] });
  }
  return { kalshi: k, perps: { equityUsd: acc?.equityUsd ?? null, peakUsd: acc?.peakUsd ?? null, ddPct: dd.ddPct, breached: dd.breached, positions: open }, actions };
}

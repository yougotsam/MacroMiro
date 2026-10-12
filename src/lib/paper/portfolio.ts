/**
 * Realistic paper portfolio replay: the chosen entries in time order, accepted only if ALL approved limits hold
 * at entry time: $3 per ticker, $9 total open worst-case, $4 same-direction correlated crypto, −$15 daily stop
 * (ET day, realized P&L from positions settled before the entry). Positions release at their close time.
 */
export const LIMITS = { perTicker: 3, total: 9, correlated: 4, dayStop: -15 } as const;
const CRYPTO = new Set(["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"]);
export type Entry = { ts: string; ticker: string; series: string; close: string; side: "yes" | "no"; cost: number; fee: number; netUsd: number | null };
const etDay = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

export function replay(entries: Entry[]) {
  const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
  const open: (Entry & { worst: number })[] = [];
  const settledByDay = new Map<string, number>();
  const accepted: Entry[] = [];
  const rejected: { entry: Entry; reason: string }[] = [];
  for (const e of sorted) {
    const t = Date.parse(e.ts);
    for (let i = open.length - 1; i >= 0; i--) {
      if (Date.parse(open[i].close) <= t) {
        const d = etDay(Date.parse(open[i].close));
        settledByDay.set(d, (settledByDay.get(d) ?? 0) + (open[i].netUsd ?? 0));
        open.splice(i, 1);
      }
    }
    const worst = e.cost + e.fee;
    const dir = e.side === "yes" ? "up" : "down";
    const corr = open.filter((o) => CRYPTO.has(o.series) && CRYPTO.has(e.series) && (o.side === "yes" ? "up" : "down") === dir).reduce((a, o) => a + o.worst, 0);
    const reason =
      (settledByDay.get(etDay(t)) ?? 0) <= LIMITS.dayStop ? "daily stop −$15 reached" :
      worst > LIMITS.perTicker + 1e-9 ? "over $3 per ticker" :
      open.reduce((a, o) => a + o.worst, 0) + worst > LIMITS.total + 1e-9 ? "over $9 total exposure" :
      CRYPTO.has(e.series) && corr + worst > LIMITS.correlated + 1e-9 ? "over $4 same-direction crypto" : null;
    if (reason) { rejected.push({ entry: e, reason }); continue; }
    open.push({ ...e, worst });
    accepted.push(e);
  }
  const done = accepted.filter((e) => e.netUsd != null);
  const reasons: Record<string, number> = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  return { accepted: accepted.length, settled: done.length, wins: done.filter((e) => (e.netUsd ?? 0) > 0).length, netUsd: +done.reduce((a, e) => a + (e.netUsd ?? 0), 0).toFixed(2), feesUsd: +done.reduce((a, e) => a + e.fee, 0).toFixed(2), rejected: rejected.length, rejectReasons: reasons };
}

/**
 * Realistic paper portfolio replay: the chosen entries in time order, accepted only if ALL approved limits hold
 * at entry time: $3 per ticker, $9 total open worst-case, $4 same-direction correlated crypto, −$15 daily stop
 * (ET day, realized P&L from positions settled before the entry). Positions release at their close time.
 * With a `mark`, hitting the day stop FLATTENS every still-open paper position at mark − 1¢ (not just blocks entries).
 */
export const LIMITS = { perTicker: 3, total: 9, correlated: 4, dayStop: -15 } as const;
const CRYPTO = new Set(["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"]);
export type Entry = { ts: string; ticker: string; series: string; close: string; side: "yes" | "no"; cost: number; fee: number; netUsd: number | null; qty?: number };
/** Mark price (our side, USD per contract) at a time, used to FLATTEN open paper positions when the day stop hits. */
export type Mark = (ticker: string, side: "yes" | "no", ms: number) => number | null;
/** 1¢ haircut on the mark when flattening (we sell into the bid, not the mid). */
export const FLATTEN_HAIRCUT = 0.01;
const etDay = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

export function replay(entries: Entry[], mark?: Mark) {
  const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
  const open: (Entry & { worst: number; src?: Entry })[] = [];
  const settledByDay = new Map<string, number>();
  const accepted: Entry[] = [];
  const rejected: { entry: Entry; reason: string }[] = [];
  const flattened: { ticker: string; at: string; netUsd: number; was: number | null }[] = [];
  /** settle everything closing at or before t, in close order; once the day stop is hit, flatten the rest at mark */
  const settleUpTo = (t: number) => {
    for (;;) {
      const due = open.filter((o) => Date.parse(o.close) <= t).sort((a, b) => a.close.localeCompare(b.close))[0];
      if (!due) return;
      open.splice(open.indexOf(due), 1);
      const cMs = Date.parse(due.close), d = etDay(cMs);
      settledByDay.set(d, (settledByDay.get(d) ?? 0) + (due.netUsd ?? 0));
      if (mark && (settledByDay.get(d) ?? 0) <= LIMITS.dayStop) {
        for (const o of [...open]) {
          const px = mark(o.ticker, o.side, cMs); if (px == null || !o.qty) continue;
          const net = +(o.qty * Math.max(0, px - FLATTEN_HAIRCUT) - o.cost - o.fee).toFixed(4);
          flattened.push({ ticker: o.ticker, at: due.close, netUsd: net, was: o.netUsd });
          const a = accepted.find((x) => x === o.src); if (a) a.netUsd = net;
          open.splice(open.indexOf(o), 1);
          settledByDay.set(d, (settledByDay.get(d) ?? 0) + net);
        }
      }
    }
  };
  for (const e0 of sorted) {
    const e = { ...e0 };
    const t = Date.parse(e.ts);
    settleUpTo(t);
    const worst = e.cost + e.fee;
    const dir = e.side === "yes" ? "up" : "down";
    const corr = open.filter((o) => CRYPTO.has(o.series) && CRYPTO.has(e.series) && (o.side === "yes" ? "up" : "down") === dir).reduce((a, o) => a + o.worst, 0);
    const reason =
      (settledByDay.get(etDay(t)) ?? 0) <= LIMITS.dayStop ? "daily stop −$15 reached" :
      worst > LIMITS.perTicker + 1e-9 ? "over $3 per ticker" :
      open.reduce((a, o) => a + o.worst, 0) + worst > LIMITS.total + 1e-9 ? "over $9 total exposure" :
      CRYPTO.has(e.series) && corr + worst > LIMITS.correlated + 1e-9 ? "over $4 same-direction crypto" : null;
    if (reason) { rejected.push({ entry: e, reason }); continue; }
    accepted.push(e);
    open.push({ ...e, worst, src: e } as Entry & { worst: number; src: Entry });
  }
  if (mark) settleUpTo(Date.now());
  const now = Date.now();
  const openNow = accepted.filter((e) => Date.parse(e.close) > now).reduce((a, e) => a + e.cost + e.fee, 0);
  const todayRealized = accepted.filter((e) => Date.parse(e.close) <= now && etDay(Date.parse(e.close)) === etDay(now)).reduce((a, e) => a + (e.netUsd ?? 0), 0);
  const done = accepted.filter((e) => e.netUsd != null);
  const reasons: Record<string, number> = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  return { accepted: accepted.length, settled: done.length, wins: done.filter((e) => (e.netUsd ?? 0) > 0).length, netUsd: +done.reduce((a, e) => a + (e.netUsd ?? 0), 0).toFixed(2), feesUsd: +done.reduce((a, e) => a + e.fee, 0).toFixed(2), rejected: rejected.length, rejectReasons: reasons, flattenedByStop: flattened.length, flattened: flattened.slice(-20),
    openExposureUsd: +openNow.toFixed(2), todayRealizedUsd: +todayRealized.toFixed(2), dailyLossRemainingUsd: +Math.max(0, todayRealized - LIMITS.dayStop).toFixed(2) };
}

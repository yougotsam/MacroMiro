/**
 * Named SHADOW setups from the sniper modules (Phase 1d). Research only: no setup feeds the live probability, the
 * gate or the approval rule (enforced by research-isolation tests). Each setup is measured for
 *   predictive value  — does the outcome beat what the settlement-only model already said? residual = y_dir − p_dir
 *   trading value     — taker entry in the setup direction at the executable ask, after the event fee, within depth
 * Features that were unavailable (no volume source, not enough bars) are never filled in: an indicator row whose
 * required module is unavailable simply does not fire that setup.
 */
import { clusteredSe, settlementCluster, type Obs } from "./calibration";
import { pnlSummary, sniperTaker } from "./analysis";

export type IndicatorRow = {
  ts: string; series: string;
  report?: Record<string, { available?: boolean; value?: unknown }>;
  sniper?: { long?: { setup?: string; score?: number; eligible?: boolean }; short?: { setup?: string; score?: number; eligible?: boolean } };
};
export type Dir = "long" | "short";
export type SetupHit = { name: string; dir: Dir };

export const SETUP_NAMES = ["TREND_PULLBACK", "SWEEP_REVERSAL", "CONFLUENCE_ELIGIBLE_13PT", "CONFLUENCE_7PLUS", "BOS_CONFIRMED", "MSS_CONFIRMED", "FVG_OPEN", "LIQUIDITY_SWEEP"] as const;

const avail = (r: IndicatorRow, k: string) => r.report?.[k]?.available === true;
const val = <T>(r: IndicatorRow, k: string) => (avail(r, k) ? (r.report![k].value as T) : undefined);

/** Which named setups fire on one indicator snapshot (only from AVAILABLE modules). */
export function setupsOf(r: IndicatorRow): SetupHit[] {
  const out: SetupHit[] = [];
  for (const dir of ["long", "short"] as Dir[]) {
    const s = r.sniper?.[dir];
    if (!s) continue;
    if (s.setup === "TREND_PULLBACK" || s.setup === "SWEEP_REVERSAL") out.push({ name: s.setup, dir });
    if (s.eligible) out.push({ name: "CONFLUENCE_ELIGIBLE_13PT", dir });
    if ((s.score ?? 0) >= 7) out.push({ name: "CONFLUENCE_7PLUS", dir });
  }
  const bos = val<{ bos?: Dir | null; mss?: Dir | null }>(r, "bos_mss");
  if (bos?.bos) out.push({ name: "BOS_CONFIRMED", dir: bos.bos });
  if (bos?.mss) out.push({ name: "MSS_CONFIRMED", dir: bos.mss });
  const fvg = val<{ direction?: Dir } | null>(r, "fvg");
  if (fvg?.direction) out.push({ name: "FVG_OPEN", dir: fvg.direction });
  const sw = val<Dir | null>(r, "liquidity_sweep");
  if (sw === "long" || sw === "short") out.push({ name: "LIQUIDITY_SWEEP", dir: sw });
  return out;
}

/** Latest indicator snapshot for the series at most `maxAgeMs` before the observation moment (no look-ahead). */
export function indicatorAt(bySeries: Map<string, Array<IndicatorRow & { ms: number }>>, o: Obs, maxAgeMs = 120_000) {
  const at = o.closeMs - o.tte * 1000;
  const xs = bySeries.get(o.series) ?? [];
  let best: (IndicatorRow & { ms: number }) | null = null;
  for (const r of xs) if (r.ms <= at && r.ms >= at - maxAgeMs && (!best || r.ms > best.ms)) best = r;
  return best;
}

export function indexIndicators(rows: IndicatorRow[]) {
  const m = new Map<string, Array<IndicatorRow & { ms: number }>>();
  for (const r of rows) {
    const ms = Date.parse(r.ts);
    if (!Number.isFinite(ms)) continue;
    m.set(r.series, [...(m.get(r.series) ?? []), { ...r, ms }]);
  }
  return m;
}

/** Per-setup predictive and trading value vs settlement-only, on the same contracts (first firing per contract). */
export function evaluateSetups(obs: Obs[], ind: Map<string, Array<IndicatorRow & { ms: number }>>) {
  const out: Record<string, unknown> = {};
  for (const name of SETUP_NAMES) {
    const resid: Array<{ cluster: number; pnl: number }> = [];
    const residMkt: number[] = [];
    const seen = new Set<string>();
    const fired = new Map<string, Dir>();
    for (const o of [...obs].sort((a, b) => a.closeMs - b.closeMs || b.tte - a.tte)) {
      if (seen.has(o.ticker)) continue;
      const r = indicatorAt(ind, o);
      const hit = r ? setupsOf(r).find((h) => h.name === name) : undefined;
      if (!hit) continue;
      seen.add(o.ticker);
      fired.set(`${o.ticker}|${o.tteBucket}`, hit.dir);
      const yDir = hit.dir === "long" ? o.y : 1 - o.y;
      const pDir = hit.dir === "long" ? o.p : 1 - o.p;
      const midDir = hit.dir === "long" ? o.mid : 1 - o.mid;
      resid.push({ cluster: settlementCluster(o.closeMs, o.series), pnl: yDir - pDir });
      residMkt.push(yDir - midDir);
    }
    const n = resid.length;
    const mean = n ? resid.reduce((a, r) => a + r.pnl, 0) / n : null;
    const meanMkt = n ? residMkt.reduce((a, x) => a + x, 0) / n : null;
    const se = clusteredSe(resid);
    const trades = sniperTaker(obs, (o) => {
      const d = fired.get(`${o.ticker}|${o.tteBucket}`);
      return d ?? null;
    });
    out[name] = {
      contracts: n, windows: new Set(resid.map((r) => r.cluster)).size,
      residualVsSettlementModel: mean == null ? null : { mean: Number(mean.toFixed(4)), clusteredSe: se == null ? null : Number(se.toFixed(4)) },
      residualVsMarketMid: meanMkt == null ? null : Number(meanMkt.toFixed(4)),
      takerAfterCost: pnlSummary(trades.trades),
      verdict: n < 30 ? "insufficient sample (<30 contracts)" : se != null && mean != null && mean - 1.96 * se > 0 ? "adds information beyond settlement model (CI > 0) — still research only" : "no demonstrated value",
    };
  }
  return out;
}

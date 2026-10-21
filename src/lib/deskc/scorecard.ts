/**
 * Decision scorecard. It scores a recorded probability. It does not refit one, and it does not send an order.
 * A row's modelPYes is whatever the desk already believed. The market price is the baseline forecast.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type DecisionRow = {
  at: number;
  expiryMs: number;
  series: string;
  setup: string;
  modelPYes: number;
  yesPrice: number;
  edge: number;
  mode: "maker" | "taker" | "none";
  featureHash: string;
  /** 1 if YES settled, 0 if NO settled, null if the contract is still open. */
  settledYes: 0 | 1 | null;
  pnlAfterFees: number | null;
  fresh: boolean;
  tteSec: number;
  /** True only when an order actually filled. Hypothetical rows stay false. */
  filled: boolean;
};

export type TteBucket = "early" | "mid" | "final";

export function tteBucket(tteSec: number): TteBucket {
  if (tteSec <= 90) return "final";
  if (tteSec <= 300) return "mid";
  return "early";
}

export function hashFeatures(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** One row per series, setup, and expiry. The earliest record wins. Later copies are overlap, not new evidence. */
export function purgeOverlaps(rows: DecisionRow[]): DecisionRow[] {
  const seen = new Set<string>();
  const out: DecisionRow[] = [];
  for (const r of [...rows].sort((a, b) => a.at - b.at)) {
    const k = `${r.series}|${r.setup}|${r.expiryMs}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function brier(rows: { p: number; y: 0 | 1 }[]): number {
  if (!rows.length) return Number.NaN;
  let s = 0;
  for (const r of rows) s += (r.p - r.y) ** 2;
  return s / rows.length;
}

export function logLoss(rows: { p: number; y: 0 | 1 }[]): number {
  if (!rows.length) return Number.NaN;
  const eps = 1e-6;
  let s = 0;
  for (const r of rows) {
    const p = Math.min(1 - eps, Math.max(eps, r.p));
    s += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
  }
  return s / rows.length;
}

/**
 * Mean of (model error − price error). Negative means the model is sharper than the price.
 * `better` is true only when the one-sided 95% upper bound is still negative. n < 2 cannot pass.
 */
export function brierBeatsPrice(
  rows: { p: number; price: number; y: 0 | 1 }[],
  z = 1.6448536269514722,
): { better: boolean; mean: number; se: number; n: number } {
  const n = rows.length;
  if (n < 2) return { better: false, mean: Number.NaN, se: Number.NaN, n };
  const d = rows.map((r) => (r.p - r.y) ** 2 - (r.price - r.y) ** 2);
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const v = d.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(v / n);
  return { better: mean + z * se < 0, mean, se, n };
}

export function deciles(rows: { p: number; y: 0 | 1 }[]): { lo: number; n: number; meanP: number; meanY: number }[] {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, n: 0, sumP: 0, sumY: 0 }));
  for (const r of rows) {
    const i = Math.min(9, Math.max(0, Math.floor(r.p * 10)));
    bins[i].n += 1;
    bins[i].sumP += r.p;
    bins[i].sumY += r.y;
  }
  return bins.map((b) => ({ lo: b.lo, n: b.n, meanP: b.n ? b.sumP / b.n : 0, meanY: b.n ? b.sumY / b.n : 0 }));
}

/** Mean after-fee pnl of settled rows. Unsettled rows are not treated as zero. */
export function netEv(rows: DecisionRow[]): number {
  const xs = rows.filter((r) => r.pnlAfterFees != null && r.settledYes != null);
  if (!xs.length) return Number.NaN;
  return xs.reduce((a, r) => a + (r.pnlAfterFees as number), 0) / xs.length;
}

export type ScoreGroup = {
  setup: string;
  series: string;
  bucket: TteBucket;
  n: number;
  brier: number;
  priceBrier: number;
  logLoss: number;
  ev: number;
  makerFills: number;
  makerPosts: number;
};

export function groupReport(rows: DecisionRow[]): ScoreGroup[] {
  const settled = purgeOverlaps(rows).filter((r) => r.settledYes != null);
  const groups = new Map<string, DecisionRow[]>();
  for (const r of settled) {
    const k = `${r.setup}|${r.series}|${tteBucket(r.tteSec)}`;
    const list = groups.get(k) ?? [];
    list.push(r);
    groups.set(k, list);
  }
  return [...groups.entries()].map(([k, xs]) => {
    const [setup, series, bucket] = k.split("|");
    const scored = xs.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
    const posts = xs.filter((r) => r.mode === "maker");
    return {
      setup,
      series,
      bucket: bucket as TteBucket,
      n: xs.length,
      brier: brier(scored),
      priceBrier: brier(scored.map((r) => ({ p: r.price, y: r.y }))),
      logLoss: logLoss(scored),
      ev: netEv(xs),
      makerFills: posts.filter((r) => r.filled).length,
      makerPosts: posts.length,
    };
  });
}

export function renderDailyReport(rows: DecisionRow[], day: string): string {
  const groups = groupReport(rows).sort((a, b) => a.setup.localeCompare(b.setup) || a.series.localeCompare(b.series));
  const lines = [`# Scorecard ${day}`, "", "| setup | series | window | n | model Brier | price Brier | log loss | after-fee EV | maker fills |", "|---|---|---|---:|---:|---:|---:|---:|---:|"];
  if (!groups.length) lines.push("| — | — | — | 0 | — | — | — | — | — |");
  for (const g of groups) {
    const n = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : "—");
    lines.push(`| ${g.setup} | ${g.series} | ${g.bucket} | ${g.n} | ${n(g.brier)} | ${n(g.priceBrier)} | ${n(g.logLoss)} | ${n(g.ev)} | ${g.makerFills}/${g.makerPosts} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function appendDecision(path: string, row: DecisionRow): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

export function readDecisions(path: string): DecisionRow[] {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as DecisionRow);
  } catch {
    return [];
  }
}

/** Non-overlapping chunks in expiry order. A row inside `embargoMs` of the previous chunk's last expiry is dropped. */
export function walkWindows(rows: DecisionRow[], size: number, embargoMs: number): DecisionRow[][] {
  const sorted = purgeOverlaps(rows).filter((r) => r.settledYes != null).sort((a, b) => a.expiryMs - b.expiryMs || a.at - b.at);
  const out: DecisionRow[][] = [];
  let cur: DecisionRow[] = [];
  let lastExpiry = Number.NEGATIVE_INFINITY;
  for (const r of sorted) {
    if (cur.length && r.expiryMs - lastExpiry < embargoMs) continue;
    if (cur.length >= size) {
      out.push(cur);
      lastExpiry = cur[cur.length - 1].expiryMs;
      cur = [];
      if (r.expiryMs - lastExpiry < embargoMs) continue;
    }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Does `alt` beat `base` on Brier? Mean of (alt error − base error).
 * Negative means alt is sharper. `better` needs at least `minN` rows and a one-sided
 * 95% upper bound that is still negative. A hairline gap does not pass.
 * This does not send an order.
 */
export function brierImproves(
  rows: { base: number; alt: number; y: 0 | 1 }[],
  z = 1.6448536269514722,
  minN = 30,
): { better: boolean; mean: number; se: number; n: number; baseBrier: number; altBrier: number } {
  const n = rows.length;
  const empty = { better: false, mean: Number.NaN, se: Number.NaN, n, baseBrier: Number.NaN, altBrier: Number.NaN };
  if (n < 2) return empty;
  const baseBrier = brier(rows.map((r) => ({ p: r.base, y: r.y })));
  const altBrier = brier(rows.map((r) => ({ p: r.alt, y: r.y })));
  const d = rows.map((r) => (r.alt - r.y) ** 2 - (r.base - r.y) ** 2);
  const mean = d.reduce((a, b) => a + b, 0) / n;
  const v = d.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(v / n);
  return { better: n >= minN && mean + z * se < 0, mean, se, n, baseBrier, altBrier };
}

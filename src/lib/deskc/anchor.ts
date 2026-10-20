/**
 * Price is the prior. A feature is added only when the walk-forward
 * forecast beats the price at 80% confidence. A rounding-level gap does not count.
 * This does not send an order and it does not move FEATURE_MAX_SHIFT.
 */
import { brier, brierBeatsPrice } from "./scorecard";

export type AnchorRow = {
  expiryMs: number;
  y: 0 | 1;
  price: number;
  features: Record<string, number>;
};

export type AnchorFit = {
  kept: string[];
  rejected: { name: string; oosBrier: number }[];
  priceBrier: number;
  modelBrier: number;
  beatsPrice: boolean;
};

const FAST_Z = 0.841621233572914;
const clip = (p: number) => Math.min(0.999, Math.max(0.001, p));

function solve(a: number[][], y: number[]): number[] {
  const n = y.length;
  const m = a.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c += 1) {
    let piv = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const div = m[c][c];
    if (Math.abs(div) < 1e-12) return Array(n).fill(0);
    for (let k = c; k <= n; k += 1) m[c][k] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = m[r][c];
      for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row) => row[n]);
}

/** Ridge fit of y − price on the named columns. Empty names means the residual is zero. */
export function fitResidual(train: AnchorRow[], names: string[], ridge = 1e-4): number[] {
  if (!names.length || train.length < names.length + 2) return names.map(() => 0);
  const cols = names.map((name) => train.map((r) => r.features[name] ?? 0));
  const mean = cols.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const scale = cols.map((c, i) => Math.sqrt(c.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / c.length) || 1);
  const x = train.map((_, i) => cols.map((c, j) => (c[i] - mean[j]) / scale[j]));
  const y = train.map((r) => r.y - r.price);
  const k = names.length;
  const xtx = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let i = 0; i < x.length; i += 1) {
    for (let a = 0; a < k; a += 1) {
      xty[a] += x[i][a] * y[i];
      for (let b = 0; b < k; b += 1) xtx[a][b] += x[i][a] * x[i][b];
    }
  }
  for (let a = 0; a < k; a += 1) xtx[a][a] += ridge;
  const beta = solve(xtx, xty);
  return names.map((_, j) => beta[j] / scale[j]);
}

export function predict(row: AnchorRow, names: string[], beta: number[], center: number[]): number {
  let r = 0;
  for (let i = 0; i < names.length; i += 1) r += ((row.features[names[i]] ?? 0) - center[i]) * beta[i];
  return clip(row.price + r);
}

function centerOf(train: AnchorRow[], names: string[]): number[] {
  return names.map((name) => train.reduce((a, r) => a + (r.features[name] ?? 0), 0) / Math.max(1, train.length));
}

/** Expanding walk-forward predictions. The first chunk is training only. */
export function oosPairs(rows: AnchorRow[], names: string[], chunk = 40): { p: number; price: number; y: 0 | 1 }[] {
  const sorted = [...rows].sort((a, b) => a.expiryMs - b.expiryMs);
  const out: { p: number; price: number; y: 0 | 1 }[] = [];
  for (let i = chunk; i < sorted.length; i += chunk) {
    const train = sorted.slice(0, i);
    const test = sorted.slice(i, i + chunk);
    const beta = fitResidual(train, names);
    const center = centerOf(train, names);
    for (const r of test) {
      const p = names.length ? predict(r, names, beta, center) : clip(r.price);
      out.push({ p, price: clip(r.price), y: r.y });
    }
  }
  return out;
}

export function oosBrier(rows: AnchorRow[], names: string[], chunk = 40): number {
  const pairs = oosPairs(rows, names, chunk);
  return pairs.length ? brier(pairs) : Number.NaN;
}

function beats(pairs: { p: number; price: number; y: 0 | 1 }[]): boolean {
  return pairs.length >= 30 && brierBeatsPrice(pairs, FAST_Z).better;
}

export function selectResidual(rows: AnchorRow[], chunk = 40): AnchorFit {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r.features)))];
  const pricePairs = oosPairs(rows, [], chunk);
  const priceBrier = pricePairs.length ? brier(pricePairs) : Number.NaN;
  const kept: string[] = [];
  const rejected: AnchorFit["rejected"] = [];
  let best = priceBrier;
  const left = new Set(names);
  while (left.size) {
    let pick: string | null = null;
    let pickScore = best;
    for (const name of left) {
      const pairs = oosPairs(rows, [...kept, name], chunk);
      const score = pairs.length ? brier(pairs) : Number.NaN;
      if (beats(pairs) && score < pickScore) {
        pick = name;
        pickScore = score;
      }
    }
    if (!pick) break;
    kept.push(pick);
    left.delete(pick);
    best = pickScore;
  }
  for (const name of left) rejected.push({ name, oosBrier: oosBrier(rows, [...kept, name], chunk) });
  const finalPairs = oosPairs(rows, kept, chunk);
  return { kept, rejected, priceBrier, modelBrier: best, beatsPrice: beats(finalPairs) };
}

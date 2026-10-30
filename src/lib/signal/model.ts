/**
 * Ridge logistic regression fit by Newton steps (IRLS). Small, exact, and repeatable: the same data gives the
 * same weights. Weights are measured from settled outcomes, never typed in. A feature with no variation in the
 * training data (live-only news before any history is logged) keeps weight 0 until data exists.
 */
import { FEATURES, toArray, type Vector } from "./features";

export type Model = {
  version: string;
  features: readonly string[];
  bias: number;
  weights: number[];
  ridge: number;
  trainedOn: { n: number; from: string; to: string };
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/** X rows without intercept; the intercept is added and not penalised. */
export function fitLogistic(X: number[][], y: number[], ridge = 5, iters = 25): { bias: number; weights: number[] } {
  const d = (X[0]?.length ?? 0) + 1;
  let w = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = [1, ...X[i]];
      let z = 0;
      for (let k = 0; k < d; k++) z += w[k] * x[k];
      const p = sigmoid(z);
      const r = p - y[i];
      const s = p * (1 - p);
      for (let a = 0; a < d; a++) {
        if (x[a] === 0) continue;
        g[a] += r * x[a];
        for (let c = a; c < d; c++) H[a][c] += s * x[a] * x[c];
      }
    }
    for (let a = 0; a < d; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
    for (let a = 1; a < d; a++) {
      g[a] += ridge * w[a];
      H[a][a] += ridge;
    }
    H[0][0] += 1e-9;
    const step = solve(H, g);
    let moved = 0;
    w = w.map((v, k) => {
      moved = Math.max(moved, Math.abs(step[k]));
      return v - step[k];
    });
    if (moved < 1e-7) break;
  }
  return { bias: w[0], weights: w.slice(1) };
}

export function predict(m: Pick<Model, "bias" | "weights">, x: number[]): number {
  let z = m.bias;
  for (let k = 0; k < x.length; k++) z += (m.weights[k] ?? 0) * x[k];
  return sigmoid(z);
}

export function predictVector(m: Model, v: Vector): number {
  if (m.features.length !== FEATURES.length || m.features.some((f, i) => f !== FEATURES[i])) throw new Error("model features do not match this build");
  return predict(m, toArray(v));
}

/** Each feature's push on the log-odds for this vector, largest first. The "why" behind a score. */
export function contributions(m: Model, v: Vector): { feature: string; push: number }[] {
  return FEATURES.map((f, k) => ({ feature: f as string, push: (m.weights[k] ?? 0) * v[f] }))
    .filter((c) => Math.abs(c.push) > 1e-4)
    .sort((a, b) => Math.abs(b.push) - Math.abs(a.push));
}

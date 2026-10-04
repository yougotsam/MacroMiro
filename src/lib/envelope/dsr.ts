/** Bailey & López de Prado, Deflated Sharpe Ratio, JPM 2014. Probability, not a z trophy. */

const GAMMA = 0.5772156649;

function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a));
  return s * y;
}

function erfInv(x: number): number {
  const a = 0.147;
  const s = x < 0 ? -1 : 1;
  const z = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + z / 2;
  return s * Math.sqrt(Math.sqrt(t * t - z / a) - t);
}

function normInv(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.SQRT2 * erfInv(2 * q - 1);
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function expectedMaxSr(nTrials: number): number {
  const n = Math.max(2, nTrials);
  const z1 = normInv(1 - 1 / n);
  const z2 = normInv(1 - 1 / (n * Math.E));
  return (1 - GAMMA) * z1 + GAMMA * z2;
}

export function tradeSharpe(pnls: number[]): number | null {
  if (pnls.length < 8) return null;
  const m = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const v = pnls.reduce((a, b) => a + (b - m) ** 2, 0) / (pnls.length - 1);
  if (v <= 0) return 0;
  return m / Math.sqrt(v);
}

export function deflatedSharpe(
  pnls: number[],
  nTrials: number,
): {
  sr: number | null;
  dsr: number | null;
  prob: number | null;
  sr0: number;
  n: number;
  nTrials: number;
  note: string;
} {
  const sr0 = expectedMaxSr(nTrials);
  const sr = tradeSharpe(pnls);
  if (sr == null) {
    return {
      sr: null,
      dsr: null,
      prob: null,
      sr0,
      n: pnls.length,
      nTrials,
      note: `Need 8 fills for DSR. Have ${pnls.length}. N frozen at ${nTrials}. No trophy.`,
    };
  }
  const se = Math.sqrt((1 + 0.5 * sr * sr) / Math.max(1, pnls.length - 1));
  const z = (sr - sr0) / se;
  const prob = normCdf(z);
  return {
    sr,
    dsr: z,
    prob,
    sr0,
    n: pnls.length,
    nTrials,
    note: `Bailey/LdP 2014 DSR = P(true SR > search-null). Bar 0.95. N=${nTrials} frozen. Per-trade, not annualized.`,
  };
}

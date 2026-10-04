export type Sign = "above" | "below" | "inline";
export type Horizon = "session" | "1d";

export type AnalogRow = {
  eventClass: string;
  surpriseSign: Sign;
  asset: string;
  horizon: Horizon;
  outcome: "up" | "down";
  priorP: number;
  n: number;
  hits: number;
};

export type EmpiricalHint = {
  id: string;
  n: number;
  hits: number;
  rate: number;
};

export const PRIORS: AnalogRow[] = [
  { eventClass: "nfp", surpriseSign: "above", asset: "GC", horizon: "session", outcome: "down", priorP: 0.58, n: 0, hits: 0 },
  { eventClass: "nfp", surpriseSign: "above", asset: "DXY", horizon: "session", outcome: "up", priorP: 0.6, n: 0, hits: 0 },
  { eventClass: "nfp", surpriseSign: "below", asset: "GC", horizon: "session", outcome: "up", priorP: 0.56, n: 0, hits: 0 },
  { eventClass: "cpi", surpriseSign: "above", asset: "GC", horizon: "session", outcome: "down", priorP: 0.55, n: 0, hits: 0 },
  { eventClass: "cpi", surpriseSign: "below", asset: "GC", horizon: "session", outcome: "up", priorP: 0.55, n: 0, hits: 0 },
  { eventClass: "fomc", surpriseSign: "above", asset: "GC", horizon: "session", outcome: "down", priorP: 0.57, n: 0, hits: 0 },
  { eventClass: "fomc", surpriseSign: "below", asset: "GC", horizon: "session", outcome: "up", priorP: 0.57, n: 0, hits: 0 },
  { eventClass: "eia_crude", surpriseSign: "above", asset: "CL", horizon: "session", outcome: "down", priorP: 0.62, n: 0, hits: 0 },
  { eventClass: "eia_crude", surpriseSign: "below", asset: "CL", horizon: "session", outcome: "up", priorP: 0.62, n: 0, hits: 0 },
  { eventClass: "gld_flow", surpriseSign: "above", asset: "GC", horizon: "1d", outcome: "up", priorP: 0.54, n: 0, hits: 0 },
  { eventClass: "btc_etf_flow", surpriseSign: "above", asset: "BTCUSD", horizon: "session", outcome: "up", priorP: 0.55, n: 0, hits: 0 },
  { eventClass: "btc_etf_flow", surpriseSign: "below", asset: "BTCUSD", horizon: "session", outcome: "down", priorP: 0.55, n: 0, hits: 0 },
];

const HINT_MAP: Record<string, string> = {
  "nfp-gold-down": "nfp:GC",
  "fomc-gold-down": "fomc:GC",
  "fomc-es-down": "fomc:ES",
  "wed-oil-down": "eia_crude:CL",
};

export function overlayEmpirical(hints: EmpiricalHint[]): AnalogRow[] {
  const byKey = new Map<string, EmpiricalHint>();
  for (const h of hints) {
    const key = HINT_MAP[h.id];
    if (key) byKey.set(key, h);
  }
  return PRIORS.map((row) => {
    const hit = byKey.get(`${row.eventClass}:${row.asset}`);
    if (!hit || hit.n < 8) return row;
    return { ...row, n: hit.n, hits: hit.hits, priorP: hit.rate };
  });
}

export function usedP(row: AnalogRow): number {
  if (row.n >= 8) return row.hits / row.n;
  return row.priorP;
}

export function analogSource(row: AnalogRow): "empirical" | "prior" {
  return row.n >= 8 ? "empirical" : "prior";
}

export function signFromSurprise(pct: number, band = 0.15): Sign {
  if (Math.abs(pct) < band) return "inline";
  return pct > 0 ? "above" : "below";
}

export function lookup(eventClass: string, sign: Sign, asset: string, rows: AnalogRow[] = PRIORS): AnalogRow | undefined {
  return rows.find((r) => r.eventClass === eventClass && r.surpriseSign === sign && r.asset === asset);
}

export function analogRule(row: AnalogRow): string {
  return `IF ${row.eventClass} ${row.surpriseSign} consensus → ${row.asset} ${row.outcome} (${row.horizon})`;
}

/** Decision ledger (every BUY and NO_TRADE) + settlement outcomes for calibration. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dataDir } from "./config";

export type Decision = {
  ts: string;
  ticker: string | null;
  series: string;
  close: string | null;
  tte_s: number | null;
  strike: number | null;
  spot: number | null;
  index_age_ms: number | null;
  book_age_ms: number | null;
  sigma: number | null;
  p_base: number | null;
  feature_shift: number | null;
  p: number | null;
  quotes: Record<string, number | null> | null;
  fee_type: string | null;
  best: { side: string; mode: string; price: number; count: number; fee: number; edge: number; edge_base: number } | null;
  action: "BUY" | "NO_TRADE" | "REFUSED" | "CANCEL";
  failed_gate: string | null;
  features: unknown;
  model: string;
  order?: { cid?: string; orderId?: string; status?: string; fill?: number; why?: string };
};

export class DecisionLedger {
  private dir: string;
  private lastByTicker = new Map<string, { gate: string | null; at: number }>();
  constructor(dir = dataDir()) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }
  get file() {
    return `${this.dir}/decisions.jsonl`;
  }
  get outcomesFile() {
    return `${this.dir}/outcomes.jsonl`;
  }
  /** NO_TRADE rows are throttled per ticker (gate change or 15 s); BUY/REFUSED/CANCEL always written. */
  write(d: Decision, now = Date.now()) {
    const key = d.ticker ?? d.series;
    if (d.action === "NO_TRADE") {
      const prev = this.lastByTicker.get(key);
      if (prev && prev.gate === d.failed_gate && now - prev.at < 15_000) return false;
    }
    this.lastByTicker.set(key, { gate: d.failed_gate, at: now });
    appendFileSync(this.file, `${JSON.stringify(d)}\n`);
    return true;
  }
  decidedTickers(): Set<string> {
    const s = new Set<string>();
    if (!existsSync(this.file)) return s;
    for (const l of readFileSync(this.file, "utf8").split("\n")) {
      const m = l.match(/"ticker":"(KX[^"]+)"/);
      if (m) s.add(m[1]);
    }
    return s;
  }
  settledTickers(): Set<string> {
    const s = new Set<string>();
    if (!existsSync(this.outcomesFile)) return s;
    for (const l of readFileSync(this.outcomesFile, "utf8").split("\n")) {
      const m = l.match(/"ticker":"(KX[^"]+)"/);
      if (m) s.add(m[1]);
    }
    return s;
  }
  outcome(row: { ticker: string; result: string; value: number | null }) {
    appendFileSync(this.outcomesFile, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
  }
}

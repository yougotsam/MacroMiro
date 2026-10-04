import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const DIR = "/workspace/data";
const FILE = `${DIR}/ledger.jsonl`;

export const STRATEGY_VERSION = "p0-safety-2026-09-22";

export type LedgerEvent = {
  ts: string;
  kind: "scan" | "order" | "fill" | "miss" | "settle" | "kill";
  market_ticker: string | null;
  series_ticker: string | null;
  market_open_time: string | null;
  market_close_time: string | null;
  settlement_reference: string | null;
  decision_time: string;
  time_to_expiry: number | null;
  side: string | null;
  intended_price: number | null;
  actual_fill_price: number | null;
  quantity: number | null;
  fees: number | null;
  spread: number | null;
  slippage: number | null;
  latency_ms: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge_before_costs: number | null;
  edge_after_costs: number | null;
  features: string | null;
  strategy_version: string;
  order_id: string | null;
  settlement_result: string | null;
  realized_pnl: number | null;
  mode: "paper" | "live" | "scan";
  note: string;
};

export function appendLedger(partial: Partial<LedgerEvent> & { kind: LedgerEvent["kind"]; note: string }) {
  mkdirSync(DIR, { recursive: true });
  const row: LedgerEvent = {
    ts: new Date().toISOString(),
    market_ticker: null,
    series_ticker: null,
    market_open_time: null,
    market_close_time: null,
    settlement_reference: null,
    decision_time: new Date().toISOString(),
    time_to_expiry: null,
    side: null,
    intended_price: null,
    actual_fill_price: null,
    quantity: null,
    fees: null,
    spread: null,
    slippage: null,
    latency_ms: null,
    model_probability: null,
    market_probability: null,
    edge_before_costs: null,
    edge_after_costs: null,
    features: null,
    strategy_version: STRATEGY_VERSION,
    order_id: null,
    settlement_result: null,
    realized_pnl: null,
    mode: "scan",
    ...partial,
  };
  appendFileSync(FILE, `${JSON.stringify(row)}\n`);
  return row;
}

export function readLedger(limit = 200): LedgerEvent[] {
  if (!existsSync(FILE)) return [];
  const lines = readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l) as LedgerEvent;
      } catch {
        return null;
      }
    })
    .filter((x): x is LedgerEvent => Boolean(x));
}

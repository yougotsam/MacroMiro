/**
 * MacroMiro desk engine v1 — one place for every live limit.
 * Every number here is enforced in code (risk.ts / gate.ts), not just displayed.
 */
export const MODEL_VERSION = "desk-v1.0-settle-martingale-2026-10-08";

export const SERIES = ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXGOLD15M"] as const;
export type Series = (typeof SERIES)[number];
export const TICKER_RE = /^KX(?:BTC|ETH|SOL|XRP|GOLD)15M-[0-9A-Z]+-[0-9A-Z]+$/;
export const ORDER_SHARD = 2; // all 5 series trade on exchange index 2 (Crypto & Commodities)

/** Settlement reference per series (from GET /markets rules + SETTLEMENT-RULES.md). */
export const REFERENCE: Record<Series, { kind: "rti60" | "pyth1m"; index: string; dp: number }> = {
  KXBTC15M: { kind: "rti60", index: "BRTI", dp: 2 },
  KXETH15M: { kind: "rti60", index: "ETHUSD_RTI", dp: 2 },
  KXSOL15M: { kind: "rti60", index: "SOLUSD_RTI", dp: 4 },
  KXXRP15M: { kind: "rti60", index: "XRPUSD_RTI", dp: 4 },
  KXGOLD15M: { kind: "pyth1m", index: "Metal.Index.1OZGOLD/USD", dp: 2 },
};

// ── Risk (hard) ──────────────────────────────────────────────────────────────
export const DAILY_STOP_USD = -15; // ET day; realized + fees + worst case of open positions and resting orders
export const MAX_ORDER_COST_USD = 3; // count × price + fee
export const MAX_OPEN_WORST_USD = 12; // all open positions + resting orders, worst case
export const MAX_ORDERS_PER_TICKER_WINDOW = 3;
export const MAX_ORDERS_PER_TICK = 1;
export const LOSS_STREAK_PAUSE = 3; // consecutive losing settlements…
export const LOSS_STREAK_PAUSE_MS = 60 * 60_000; // …pause 60 minutes

// ── Gate ─────────────────────────────────────────────────────────────────────
export const UNCERTAINTY = 0.02; // subtracted from P on every side
export const PRICE_MIN = 0.04;
export const PRICE_MAX = 0.93;
export const MAKER_MIN_EDGE = 0.01;
export const TAKER_MIN_EDGE = 0.04;
export const BASE_MIN_EDGE = 0.01; // the settlement model alone (no features) must show this much on the chosen side/price
export const FEATURE_MAX_SHIFT = 0.04;
export const P_CLAMP = 0.98; // never claim more certainty than this
export const MIN_SECONDS_LEFT = 3;

// ── Freshness ────────────────────────────────────────────────────────────────
export const BOOK_MAX_AGE_MS = 3_000;
export const INDEX_MAX_AGE_MS = 5_000;
export const BAR_MAX_AGE_MS = 90_000; // last closed 1m bar must be this recent
export const EXCHANGE_STATUS_MAX_AGE_MS = 15_000;
export const MIN_VOL_SAMPLES = 60; // 10 minutes of 10-second returns

export const TAKER_FEE_RATE = 0.07; // quadratic × fee_multiplier (read live from /series)

export function dataDir() {
  return process.env.DESK_DATA_DIR || "/workspace/data/desk";
}
export const SECRETS_DIR = process.env.DESK_SECRETS_DIR || "/workspace/.grok/secrets";

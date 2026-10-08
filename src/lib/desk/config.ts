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

// ── Adverse selection / execution protection ─────────────────────────────────
export const MODEL_REV = "guard-1"; // execution-guard revision (logged with decisions)
export const FAST_K = 3; // a move > K·σ·√L over L s (σ = the probability model's per-second σ) is "fast"
export const FAST_LOOKBACKS_SEC = [2, 3, 4, 5];
export const FAST_COOLDOWN_MS = 10_000; // no new orders on the series for ≥ this long after a fast move…
export const FAST_SETTLE_Z = 1.5; // …and until the 5 s move is back under this many σ
export const SHOCK_LATENCY_SEC = 3; // a resting bid is exposed for ~one 1 s tick + cancel round trip
export const HOLD_SHOCK_FRAC = 0.5; // keep a resting bid while edge ≥ this × shock (post needs 1¢ + shock)
export const FINAL_PULL_SEC = 45; // in the last N s resting bids are pulled…
export const LOCK_MIN_FRAC = 0.6; // …unless ≥ 60 % of the 60 s average is already printed (crypto only)
export const LAST_MINUTE_SEC = 60;
export const LAST_MINUTE_MIN_PRICE = 0.05; // never buy under 5¢ in the last minute
export const TICK_MS = 1_000;
export const SNAPSHOT_EVERY_MS = 2_000; // account snapshot cadence (refreshed immediately after any send)
export const GUARD_EVERY_MS = 250; // fast-move guard reads the websocket prints, no REST

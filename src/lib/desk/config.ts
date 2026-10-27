/**
 * MacroMiro desk engine v1 — one place for every live limit.
 * Every number here is enforced in code (risk.ts / gate.ts), not just displayed.
 */
export const MODEL_VERSION = "aurix-x-v1.2-settlement-correctness-2026-10-09";
/** 15-minute orders stay refused until a human turns this on. The entry law is fresh-law.ts. */
export const CALIBRATED_MODEL_APPROVED: boolean = false;
/** Never reset an intraday loss latch with an on-disk override. */
export const ENABLE_RISK_OVERRIDES: boolean = false;

export const SERIES = ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXDOGE15M", "KXGOLD15M", "KXSILVER15M", "KXWTI15M", "KXGBPUSD15M", "KXEURUSD15M", "KXUSDJPY15M"] as const;
export type Series = (typeof SERIES)[number];
export const TICKER_RE = /^KX(?:BTC|ETH|SOL|XRP|DOGE|GOLD|SILVER|WTI|GBPUSD|EURUSD|USDJPY)15M-[0-9A-Z]+-[0-9A-Z]+$/;
export const ORDER_SHARD = 2; // Where the funded cash sits. Every market spends that one pile.

/** Settlement reference per series (from GET /markets rules + SETTLEMENT-RULES.md). */
export const REFERENCE: Record<Series, { kind: "rti60" | "pyth1m"; index: string; dp: number }> = {
  KXBTC15M: { kind: "rti60", index: "BRTI", dp: 2 },
  KXETH15M: { kind: "rti60", index: "ETHUSD_RTI", dp: 2 },
  KXSOL15M: { kind: "rti60", index: "SOLUSD_RTI", dp: 4 },
  KXXRP15M: { kind: "rti60", index: "XRPUSD_RTI", dp: 4 },
  KXDOGE15M: { kind: "rti60", index: "DOGEUSD_RTI", dp: 6 },
  KXGOLD15M: { kind: "pyth1m", index: "Metal.Index.1OZGOLD/USD", dp: 2 },
  KXSILVER15M: { kind: "pyth1m", index: "Metal.Index.SILVER/USD", dp: 3 },
  KXWTI15M: { kind: "pyth1m", index: "Commodities.Index.PYTHOIL/USD", dp: 2 },
  KXGBPUSD15M: { kind: "pyth1m", index: "FX.GBP/USD", dp: 5 },
  KXEURUSD15M: { kind: "pyth1m", index: "FX.EUR/USD", dp: 5 },
  KXUSDJPY15M: { kind: "pyth1m", index: "FX.USD/JPY", dp: 3 },
};

// ── Risk (hard) ──────────────────────────────────────────────────────────────
/**
 * Approved research risk settings (Sameer, 2026-10-09, PR #2 round 3). One typed object, enforced in risk.ts
 * on the final OMS choke point. Changing a number is a reviewed code release; there is no on-disk override.
 *  - mode "usd": the USD numbers apply as written.
 *  - mode "pct_of_account": each limit = pct × account value (Kalshi balance + portfolio value), but never looser
 *    than `ceilingUsd` (the ceilings default to the approved USD numbers, so % mode can only tighten until a
 *    reviewed release raises a ceiling). Unknown account value in % mode refuses every order (fail closed).
 * Day stop: realized + fees + worst case of open positions, resting orders and ambiguous sends (ET day).
 */
export type LimitSet = { dayStop: number; total: number; perTicker: number; correlated: number; perOrder: number };
export type RiskLimits = { mode: "usd" | "pct_of_account"; usd: LimitSet; pct: LimitSet; ceilingUsd: LimitSet };
const APPROVED_USD: LimitSet = { dayStop: -15, total: 9, perTicker: 3, correlated: 4, perOrder: 3 };
export const RISK_LIMITS: RiskLimits = Object.freeze({
  mode: "usd",
  usd: Object.freeze({ ...APPROVED_USD }),
  // placeholders for later scaling — owner to set; inactive while mode = "usd"
  pct: Object.freeze({ dayStop: -0.15, total: 0.09, perTicker: 0.03, correlated: 0.04, perOrder: 0.03 }),
  ceilingUsd: Object.freeze({ ...APPROVED_USD }),
}) as RiskLimits;

export type ResolvedLimits = ({ ok: true } & LimitSet) | { ok: false; why: string };
/** Pure: the USD limits in force for an account value (null = unknown). */
export function resolveRiskLimits(l: RiskLimits, accountValueUsd: number | null | undefined): ResolvedLimits {
  const vals = (x: LimitSet) => [x.dayStop, x.total, x.perTicker, x.correlated, x.perOrder];
  const sane = (x: LimitSet) => vals(x).every(Number.isFinite) && x.dayStop < 0 && x.total > 0 && x.perTicker > 0 && x.correlated > 0 && x.perOrder > 0;
  if (!sane(l.usd) || !sane(l.ceilingUsd)) return { ok: false, why: "risk limits misconfigured" };
  if (l.mode === "usd") return { ok: true, ...l.usd };
  if (l.mode !== "pct_of_account") return { ok: false, why: "risk limit mode unknown" };
  if (!sane(l.pct) || vals(l.pct).some((x) => Math.abs(x) > 1)) return { ok: false, why: "risk % limits misconfigured" };
  if (accountValueUsd == null || !Number.isFinite(accountValueUsd) || accountValueUsd <= 0) return { ok: false, why: "account value unknown (% limits)" };
  const a = accountValueUsd;
  const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
  return {
    ok: true,
    dayStop: r4(Math.max(l.pct.dayStop * a, l.ceilingUsd.dayStop)), // less negative = tighter
    total: r4(Math.min(l.pct.total * a, l.ceilingUsd.total)),
    perTicker: r4(Math.min(l.pct.perTicker * a, l.ceilingUsd.perTicker)),
    correlated: r4(Math.min(l.pct.correlated * a, l.ceilingUsd.correlated)),
    perOrder: r4(Math.min(l.pct.perOrder * a, l.ceilingUsd.perOrder)),
  };
}
export const DAILY_STOP_USD = RISK_LIMITS.usd.dayStop; // −15 (approved 2026-10-09; was −5)
export const MAX_ORDER_COST_USD = RISK_LIMITS.usd.perOrder; // count × price + fee
export const MAX_OPEN_WORST_USD = RISK_LIMITS.usd.total; // all open positions + resting orders + ambiguous sends, worst case
/** Worst case allowed on ONE ticker: open + resting + ambiguous sends + the new order. */
export const MAX_TICKER_WORST_USD = RISK_LIMITS.usd.perTicker;
/**
 * Worst case allowed in ONE correlated group: same direction across all crypto series (BTC/ETH/SOL/XRP), any open
 * window; gold is its own group (exposure.ts). Approved $4.
 */
export const MAX_CORRELATED_WORST_USD = RISK_LIMITS.usd.correlated;
export const MAX_ORDERS_PER_TICKER_WINDOW = 1; // one send per contract. A second series in the same 15 minutes is allowed.
export const MAX_ORDERS_PER_TICK = 1;
export const LOSS_STREAK_PAUSE = 3; // three settled losses in a row, then sit out. A win resets the count.
export const LOSS_STREAK_PAUSE_MS = 20 * 60_000;
/** Three back-to-back losing settlements block new orders for 20 minutes from the third settlement. One loss does not. */
export const POST_LOSS_PAUSE_MS = 20 * 60_000;

// ── Gate ─────────────────────────────────────────────────────────────────────
export const UNCERTAINTY = 0.02; // subtracted from P on every side
export const PRICE_MIN = 0.36; // Floor on a 15-minute contract. Not a claim that the price above it wins.
export const PRICE_MAX = 0.95; // Above 95¢ the fee eats the favorite.
export const MAKER_MIN_EDGE = 0.01;
export const TAKER_MIN_EDGE = 0.04;
export const BASE_MIN_EDGE = 0.01; // the settlement model alone (no features) must show this much on the chosen side/price
export const FEATURE_MAX_SHIFT = 0.04; // the small chart vote, before the confluence step.
export const LOGIT_CONFLUENCE = 0.45; // sniper score >= 8, or a feature score at least 0.45.
export const LOGIT_HIGH = 0.80; // sniper score >= 11, or a feature score at least 0.75. Not cut by the 4-point cap.
export const WINDOW_EQUITY_CAP = 0.15; // half-Kelly may talk about 15% of equity. The $3 order cap is tighter and is the one that sends.
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
export const LAST_MINUTE_MIN_PRICE = 0.36; // same floor as PRICE_MIN. The last minute does not reopen cheap contracts.
export const TICK_MS = 1_000;
export const SNAPSHOT_EVERY_MS = 2_000; // account snapshot cadence (refreshed immediately after any send)
export const GUARD_EVERY_MS = 250; // fast-move guard reads the websocket prints, no REST

// ── Approval policy (round 3, Sameer 2026-10-09) ───────────────────────────────
/**
 * Approval needs a CALIBRATED settlement probability (an operator-approved calibrator file bound to this model version)
 * and a positive conservative EV at the executable Kalshi price after fees and this cushion. The 13-point confluence
 * score is kept as a ranker/context only. Rollback flag: false = the exact pre-round-3 gate path.
 */
export const APPROVAL_POLICY_ENFORCED: boolean = false;
/** Uncertainty cushion on the calibrated side probability (placeholder until calibration evidence sets it; owner decision). */
export const APPROVAL_CUSHION = 0.03;
export function calibratorPath() {
  return `${dataDir()}/calibrator.json`;
}
/** Which time-to-expiry policy is active ("current" reproduces the pre-round-3 timing exactly). */
export const TIMING_POLICY: "current" | "final10_proposal" = "current";

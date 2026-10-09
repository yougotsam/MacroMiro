/**
 * Independent risk engine. EVERY order must pass `RiskEngine.check()` — the OMS calls it at the
 * final submit choke point (oms.ts → submitOrder), immediately before the signed POST.
 *
 * Day P/L (ET day, from Kalshi's own records, desk series only):
 *   realized  = Σ settlements settled today: revenue − yes_cost − no_cost − fees
 *   openWorst = Σ open positions: market exposure + fees paid   (assume every open contract loses)
 *   restWorst = Σ resting orders: remaining × price + fee bound (assume every resting order fills and loses)
 *   dayWorst  = realized − openWorst − restWorst
 * Refuse any order whose worst case would take dayWorst below DAILY_STOP_USD. Once dayWorst ≤ stop,
 * latch OFF for the rest of the ET day (persisted to disk, survives restarts).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  DAILY_STOP_USD,
  ENABLE_RISK_OVERRIDES,
  LOSS_STREAK_PAUSE,
  LOSS_STREAK_PAUSE_MS,
  MAX_CORRELATED_WORST_USD,
  MAX_OPEN_WORST_USD,
  MAX_ORDER_COST_USD,
  MAX_ORDERS_PER_TICK,
  MAX_ORDERS_PER_TICKER_WINDOW,
  PRICE_MAX,
  PRICE_MIN,
  SECRETS_DIR,
  TICKER_RE,
  dataDir,
} from "./config";
import { etDay } from "./time";
import { activeOverride, applyOverride, loadOverrides } from "./override";

export type Settled = { ticker: string; pnl: number; settledMs: number };

export type AccountSnapshot = {
  fetchedAt: number;
  etDay: string;
  realizedToday: number;
  openWorst: number;
  restWorst: number;
  /** unconfirmed OMS sends (timeout, not yet found) count as worst case too */
  pendingWorst: number;
  shard2Cash: number;
  settledToday: Settled[];
  /** desk orders already sent per ticker (Kalshi + local journal, max of both) */
  ordersPerTicker: Record<string, number>;
  /** worst case per (15-minute window, direction) across all coins: open + resting + pending */
  correlated?: Record<string, number>;
  exchangeTradingActive: boolean;
  exchangeCheckedAt: number;
  /** set when a dated risk override (override.ts) re-based the day: baseline = realized before its start */
  override?: { id: string; baseline: number; start: string; expires: string };
};

export type OrderIntent = {
  product: "event" | "perp";
  ticker: string;
  side: "yes" | "no";
  mode: "maker" | "taker";
  price: number;
  count: number;
  fee: number;
  tickId: number;
};

export type RiskDecision = { ok: boolean; why: string; dayWorst: number; projected: number; orderWorst: number };

export type RiskFile = { latchedDay: string | null; latchReason: string | null; latchedAt: string | null; updatedAt: string };

export const SNAPSHOT_MAX_AGE_MS = 20_000;

export function dayWorstOf(s: AccountSnapshot) {
  return Number((s.realizedToday - s.openWorst - s.restWorst - s.pendingWorst).toFixed(4));
}

/** 3 consecutive losing settlements → pause 60 minutes from the 3rd loss. Wins reset the streak. */
export function streakPauseUntil(settled: Settled[]): number {
  const s = [...settled].sort((a, b) => a.settledMs - b.settledMs);
  let streak = 0;
  let until = 0;
  for (const x of s) {
    if (x.settledMs < until) continue; // inside a pause window: the streak restarts after it
    if (x.pnl < 0) {
      streak += 1;
      if (streak >= LOSS_STREAK_PAUSE) {
        until = x.settledMs + LOSS_STREAK_PAUSE_MS;
        streak = 0;
      }
    } else if (x.pnl > 0) streak = 0;
  }
  return until;
}

function flag(name: string) {
  try {
    const f = `${SECRETS_DIR}/${name}`;
    return existsSync(f) && readFileSync(f, "utf8").trim() === "1";
  } catch {
    return false;
  }
}
export const switches = {
  live: () => flag("kalshi_live"),
  begin: () => flag("kalshi_begin"),
  arm: () => flag("desk_arm"),
};

export function switchState(): { live: boolean; begin: boolean; arm: boolean } {
  return { live: switches.live(), begin: switches.begin(), arm: switches.arm() };
}

export class RiskEngine {
  private file: string;
  private dir: string;
  private tickCount = new Map<number, number>();
  private announced = new Set<string>();
  constructor(dir = dataDir(), private sw = switches) {
    mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.file = `${dir}/risk-state.json`;
  }

  /** The day P/L view the stop is enforced on: Kalshi's snapshot, re-based by an active dated override (if any). */
  effective(s: AccountSnapshot, now = Date.now()): AccountSnapshot {
    const o = ENABLE_RISK_OVERRIDES ? activeOverride(loadOverrides(this.dir), now) : null;
    if (o && !this.announced.has(o.id)) {
      this.announced.add(o.id);
      try {
        appendFileSync(`${this.dir}/risk-events.log`, `${new Date(now).toISOString()} override ${o.id} active (${o.reason}) start ${o.start} expires ${o.expires}\n`);
      } catch {
        /* audit line best effort */
      }
    }
    return applyOverride(s, o);
  }

  read(): RiskFile {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as RiskFile;
    } catch {
      if (!existsSync(this.file)) {
        return { latchedDay: null, latchReason: null, latchedAt: null, updatedAt: new Date().toISOString() };
      }
      // Existing but unreadable risk state must NEVER reset trading eligibility.
      return { latchedDay: etDay(Date.now()), latchReason: "risk state unreadable", latchedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
  }

  latched(now = Date.now()) {
    const f = this.read();
    if (f.latchedDay !== etDay(now)) return null;
    // a latch set before an active fresh-start override belongs to the re-based part of the day
    const o = ENABLE_RISK_OVERRIDES ? activeOverride(loadOverrides(this.dir), now) : null;
    if (o && f.latchedAt && Date.parse(f.latchedAt) < Date.parse(o.start)) return null;
    return f;
  }

  latch(reason: string, now = Date.now()) {
    const f: RiskFile = { latchedDay: etDay(now), latchReason: reason, latchedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    writeFileSync(this.file, JSON.stringify(f, null, 2));
    return f;
  }

  /** Called on every fresh snapshot, even with no order: latches the day once the stop is reached. */
  observe(snap: AccountSnapshot, now = Date.now()) {
    const s = this.effective(snap, now);
    const worst = dayWorstOf(s);
    if (s.etDay === etDay(now) && worst <= DAILY_STOP_USD && !this.latched(now)) {
      this.latch(`day worst ${worst.toFixed(2)} ≤ ${DAILY_STOP_USD}`, now);
    }
    return worst;
  }

  check(o: OrderIntent, snap: AccountSnapshot | null, now = Date.now()): RiskDecision {
    const s = snap ? this.effective(snap, now) : null;
    const orderWorst = Number((o.count * o.price + Math.max(0, o.fee)).toFixed(4));
    const no = (why: string, dayWorst = NaN, projected = NaN): RiskDecision => ({ ok: false, why, dayWorst, projected, orderWorst });
    if (o.product !== "event") return no("perps disabled");
    if (!Number.isInteger(o.count) || o.count < 1 || !Number.isFinite(o.price) ||
        !Number.isFinite(o.fee) || o.fee < 0 || !Number.isInteger(o.tickId)) return no("invalid order parameters");
    if (!this.sw.live()) return no("switch kalshi_live off");
    if (!this.sw.begin()) return no("switch kalshi_begin off");
    if (!this.sw.arm()) return no("ARM off");
    if (!s) return no("no account snapshot");
    if (!Number.isFinite(s.fetchedAt) || s.fetchedAt > now + 500 ||
        now - s.fetchedAt > SNAPSHOT_MAX_AGE_MS) return no("account snapshot stale");
    const amounts = [s.realizedToday, s.openWorst, s.restWorst, s.pendingWorst, s.shard2Cash];
    if (amounts.some((x) => !Number.isFinite(x)) ||
        s.openWorst < 0 || s.restWorst < 0 || s.pendingWorst < 0 || s.shard2Cash < 0) return no("invalid account snapshot");
    if (s.etDay !== etDay(now)) return no("snapshot from another ET day");
    if (!s.exchangeTradingActive || now - s.exchangeCheckedAt > 15_000) return no("exchange trading paused/unknown");
    const l = this.latched(now);
    if (l) return no(`daily stop latched: ${l.latchReason}`);
    const dayWorst = this.observe(s, now);
    if (this.latched(now)) return no(`daily stop latched: day worst ${dayWorst.toFixed(2)}`, dayWorst);
    const pause = streakPauseUntil(s.settledToday);
    if (pause > now) return no(`loss streak pause until ${new Date(pause).toISOString()}`, dayWorst);
    if (!TICKER_RE.test(o.ticker)) return no("ticker not a desk 15m series", dayWorst);
    if (!(o.count >= 1) || !Number.isFinite(o.price)) return no("bad size/price", dayWorst);
    if (o.price < PRICE_MIN || o.price > PRICE_MAX) return no("price band", dayWorst);
    if (orderWorst > MAX_ORDER_COST_USD + 1e-9) return no(`order cost ${orderWorst.toFixed(2)} > ${MAX_ORDER_COST_USD}`, dayWorst);
    const projected = Number((dayWorst - orderWorst).toFixed(4));
    if (projected < DAILY_STOP_USD) return no(`would breach daily stop: ${dayWorst.toFixed(2)} − ${orderWorst.toFixed(2)} < ${DAILY_STOP_USD}`, dayWorst, projected);
    const exposure = s.openWorst + s.restWorst + s.pendingWorst + orderWorst;
    if (exposure > MAX_OPEN_WORST_USD + 1e-9) return no(`exposure ${exposure.toFixed(2)} > ${MAX_OPEN_WORST_USD}`, dayWorst, projected);
    const corrKey = `${o.ticker.split("-")[1] ?? o.ticker}|${o.side === "no" ? "down" : "up"}`;
    const corr = (s.correlated?.[corrKey] ?? 0) + orderWorst;
    if (corr > MAX_CORRELATED_WORST_USD + 1e-9) return no(`correlated window ${corrKey} ${corr.toFixed(2)} > ${MAX_CORRELATED_WORST_USD}`, dayWorst, projected);
    if ((s.ordersPerTicker[o.ticker] ?? 0) >= MAX_ORDERS_PER_TICKER_WINDOW) return no(`ticker order cap ${MAX_ORDERS_PER_TICKER_WINDOW}`, dayWorst, projected);
    if ((this.tickCount.get(o.tickId) ?? 0) >= MAX_ORDERS_PER_TICK) return no("one order per tick", dayWorst, projected);
    if (s.shard2Cash < orderWorst) return no(`shard 2 cash ${s.shard2Cash.toFixed(2)} < ${orderWorst.toFixed(2)}`, dayWorst, projected);
    return { ok: true, why: "risk ok", dayWorst, projected, orderWorst };
  }

  /** Consume the per-tick slot (call only right before the POST). */
  consume(o: OrderIntent) {
    this.tickCount.set(o.tickId, (this.tickCount.get(o.tickId) ?? 0) + 1);
    if (this.tickCount.size > 100) this.tickCount.delete(this.tickCount.keys().next().value as number);
  }
}

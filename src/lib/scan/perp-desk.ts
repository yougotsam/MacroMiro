/** Kalshi margin perps. Not the 15-minute ticket.
 * A lean is not an order. This file never sets authorizesOrder. Live sends stay in perps/oms.ts and need a stop plan.
 * Leverage stays at 3x. Kalshi treats liquidation as not a stop, and a higher multiple moves that price closer.
 */
export const PERP_DESK_AUTHORIZES_ORDERS = false;
export const PERP_MAX_LEVERAGE = 3;
/** Sit when the book is wider than this. 8 bps. A 20-dollar gap on a 4,000-dollar price is about 50 bps and sits. */
export const PERP_MAX_SPREAD_BPS = 8;
/** Sit when 8-hour funding charges this side more than 5 bps. Same bound as the research candidate. */
export const PERP_MAX_FUNDING_AGAINST = 0.0005;

export const PERP_TICKERS = ["KXGOLDPERP", "KXBTCPERP", "KXETHPERP", "KXSOLPERP", "KXXRPPERP", "KXBNBPERP", "KXSILVERPERP", "KXUS500PERP"] as const;

export type PerpCall = {
  take: boolean;
  ticker: string;
  side: "bid" | "ask" | null;
  pushOverNoise: number;
  /** Leverage we will actually use. Lower than the contract max on purpose. */
  useLev: number;
  why: string;
  /** Always false. A lean is not an order. candidates.ts is the selector. */
  authorizesOrder: false;
};

type Tape = { minute: number; price: number };
const tapes = new Map<string, Tape[]>();

export function notePerpPrice(ticker: string, price: number, now = Date.now()) {
  if (!(price > 0)) return;
  const minute = Math.floor(now / 60_000);
  const row = tapes.get(ticker) ?? [];
  const last = row[row.length - 1];
  if (last && last.minute === minute) last.price = price;
  else row.push({ minute, price });
  tapes.set(ticker, row.slice(-30));
}

function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Never above 3x. A louder push does not earn more leverage. */
export function pickLeverage(maxLev: number, pushOverNoise: number) {
  if (!(pushOverNoise >= 2) || !(maxLev >= 2)) return 0;
  return Number(Math.min(PERP_MAX_LEVERAGE, maxLev).toFixed(2));
}

/** Three finished minutes, same way, push at least twice the noise, spread at most 8 bps, funding known and not charging this side. */
export function perpDecision(ticker: string, bid: number, ask: number, lev: number, funding8h: number | null = null): PerpCall {
  const sit = (why: string): PerpCall => ({ take: false, ticker, side: null, pushOverNoise: 0, useLev: 0, why, authorizesOrder: false });
  if (!(bid > 0) || !(ask > 0) || ask < bid) return sit("no book");
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  if (spreadBps > PERP_MAX_SPREAD_BPS) return sit(`spread ${spreadBps.toFixed(1)} bps`);
  if (!(lev >= 2)) return sit("leverage unread");
  if (funding8h == null || !Number.isFinite(funding8h)) return sit("funding unread");
  const rows = tapes.get(ticker) ?? [];
  if (rows.length < 4) return sit("need three finished minutes");
  const closes = rows.slice(-8).map((r) => r.price);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const last3 = returns.slice(-3);
  if (last3.length < 3) return sit("need three finished minutes");
  const up = last3.every((r) => r > 0);
  const down = last3.every((r) => r < 0);
  if (!up && !down) return sit("no three-minute push");
  if (up && funding8h > PERP_MAX_FUNDING_AGAINST) return sit("funding charges longs");
  if (down && funding8h < -PERP_MAX_FUNDING_AGAINST) return sit("funding charges shorts");
  const noise = stdev(returns);
  const push = Math.abs(last3.reduce((a, b) => a + b, 0));
  const ratio = noise > 0 ? push / noise : 0;
  if (!(noise > 0) || ratio < 2) return sit("push inside the noise");
  const useLev = pickLeverage(lev, ratio);
  if (!(useLev > 0)) return sit("leverage capped at zero");
  return {
    take: true,
    ticker,
    side: up ? "bid" : "ask",
    pushOverNoise: ratio,
    useLev,
    why: `${up ? "long" : "short"} · ${(push * 100).toFixed(2)}% / noise ${(noise * 100).toFixed(2)}% · ${useLev.toFixed(1)}x · funding ${(funding8h * 100).toFixed(3)}%`,
    authorizesOrder: false,
  };
}

export function perpCount(price: number, contractSize: number, lev: number, marginUsd = 30) {
  const unit = price * (contractSize > 0 ? contractSize : 1);
  if (!(unit > 0) || !(lev > 0)) return 0;
  return Math.max(0.001, Number(((marginUsd * lev) / unit).toFixed(6)));
}

export function perpStops(entry: number, side: "bid" | "ask", lev: number) {
  const stopPct = 0.1 / lev;
  const takePct = 0.2 / lev;
  if (side === "bid") return { stop: entry * (1 - stopPct), takeProfit: entry * (1 + takePct) };
  return { stop: entry * (1 + stopPct), takeProfit: entry * (1 - takePct) };
}

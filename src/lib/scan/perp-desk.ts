/** Kalshi margin perps. Not the 15-minute ticket. Not Hyperliquid. */

export const PERP_TICKERS = ["KXGOLDPERP", "KXBTCPERP", "KXETHPERP", "KXSOLPERP", "KXXRPPERP", "KXBNBPERP", "KXSILVERPERP", "KXUS500PERP"] as const;

export type PerpCall = {
  take: boolean;
  ticker: string;
  side: "bid" | "ask" | null;
  pushOverNoise: number;
  /** Leverage we will actually use. Lower than the contract max on purpose. */
  useLev: number;
  why: string;
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

/** 3x rides noise. 5x is a normal push. The contract max is only for a sniper push. */
export function pickLeverage(maxLev: number, pushOverNoise: number) {
  const max = Math.min(20, Math.max(1, maxLev));
  if (pushOverNoise >= 3) return Number(max.toFixed(2));
  if (pushOverNoise >= 2.4) return Number(Math.min(5, max).toFixed(2));
  return Number(Math.min(3, max).toFixed(2));
}

/** Three finished minutes, all the same way, and the push is at least twice the recent noise. Bear kills a wide book or a reward under 2:1. */
export function perpDecision(ticker: string, bid: number, ask: number, lev: number): PerpCall {
  const sit = (why: string): PerpCall => ({ take: false, ticker, side: null, pushOverNoise: 0, useLev: 0, why });
  if (!(bid > 0) || !(ask > 0) || ask < bid) return sit("no book");
  const mid = (bid + ask) / 2;
  const spread = (ask - bid) / mid;
  if (spread > 0.0015) return sit("spread too wide");
  if (!(lev >= 2)) return sit("leverage unread");
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
  const noise = stdev(returns);
  const push = Math.abs(last3.reduce((a, b) => a + b, 0));
  const ratio = noise > 0 ? push / noise : 0;
  if (!(noise > 0) || ratio < 2) return sit("push inside the noise");
  const useLev = pickLeverage(lev, ratio);
  return {
    take: true,
    ticker,
    side: up ? "bid" : "ask",
    pushOverNoise: ratio,
    useLev,
    why: `${up ? "long" : "short"} · ${(push * 100).toFixed(2)}% / noise ${(noise * 100).toFixed(2)}% · ${useLev.toFixed(1)}x of ${lev.toFixed(1)}x max`,
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

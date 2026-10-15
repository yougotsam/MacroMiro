/**
 * Honest perps simulator: CAUSAL REPLAY over venue 1-minute candles. It is not a live fill record. It uses the SAME code
 * as the live path: buildPerpsCandidate (signal, stop, targets), sizePosition (mandate sizing + margin caps),
 * stepBar (management: partial, break-even, trail, time).
 * Fill model (conservative):
 *  - Maker entry: a post-only limit at our side of the book (close − half spread for longs). It fills ONLY if a later
 *    1m bar trades THROUGH the limit by ≥ 1 tick within `makerWaitBars`. A bare touch does not fill (we sit behind the
 *    queue). If the bar only reaches through by < `fullFillTicks`, we get a partial fill of `partialFrac`.
 *    Because a fill needs price to move against us first, adverse selection is built in.
 *  - Taker entry: fill at the next bar's open + half spread + slipTicks.
 *  - Exits: T1/T2 are resting maker limits. Stop/trail/time exits pay taker fees + slipTicks. A bar that opens past the
 *    stop fills at the open (gap).
 *  - Funding at the decision is the last venue rate with tMs <= decideMs. A missing rate is UNKNOWN, not 0.
 *    Rates that settle during the hold are charged then (that is the bill, not a look-ahead into the entry).
 *  - The book built from the candle close is synthetic. Depth is not a fill. Label stays CANDLE_ONLY_NOT_EXECUTABLE.
 */
import { buildPerpsCandidate } from "./candidates";
import { startState, stepBar, type ManagePlan } from "./manage";
import { sizePosition, aggressiveProfile, type Profile } from "./mandate";
import type { MarginSpec } from "./margin";
import type { Candle } from "@/lib/desk/sniper";
import type { PerpMarket } from "./kalshi-perps-read";

export type SimData = { market: PerpMarket; m1: Candle[]; h1: Candle[]; spreadHalf: number; funding: { tMs: number; rate: number }[]; maker: number; taker: number; spec: MarginSpec; group: string };
export type SimCfg = { name: string; riskPct: number; entry: "maker" | "taker"; gate: "strict9" | "aggr7"; makerWaitBars: number; slipTicks: number; partialFrac: number; fullFillTicks: number; maxHoldMin: number; startEquity: number; macroClear?: (tMs: number) => boolean; select?: SelectHook };
/** Pluggable maker hook (src/lib/loop/maker.ts): sees the qualifying code candidates at a closed 15m bar and returns the
 * chosen direction, or null to skip. Undefined hook = the code engine (highest score). Must be sync and causal. */
export type SelectCtx = { ticker: string; decideMs: number; b15: Candle[]; quals: { dir: "long" | "short"; setup: string; score: number; entry: number; stop: number; winNet: number; lossNet: number }[] };
export type SelectHook = (ctx: SelectCtx) => "long" | "short" | null;
export type SimTrade = { t: number; dir: string; setup: string; score: number; entry: number; stop: number; qty: number; notional: number; lev: number; filledFrac: number; exits: string; gross: number; fees: number; funding: number; fundingRateAtDecision: number | null; net: number; holdMin: number; equityAfter: number; executionClass: "candle_proxy_not_a_fill" };
export type SimResult = { cfg: string; market: string; signals: number; makerMisses: number; trades: SimTrade[]; netUsd: number; endEquity: number; maxDdPct: number; winRate: number | null; avgWin: number | null; avgLoss: number | null; exposurePct: number; avgLev: number | null; liquidations: number; incomplete15m: number; label: "CANDLE_ONLY_NOT_EXECUTABLE" };

/** Last funding print that existed at the decision. Later prints are not visible yet. */
export function fundingAsOf(funding: { tMs: number; rate: number }[], decideMs: number): { rate8h: number | null; asOfMs: number | null } {
  let best: { tMs: number; rate: number } | null = null;
  for (const f of funding) if (f.tMs <= decideMs && (best == null || f.tMs > best.tMs)) best = f;
  return best ? { rate8h: best.rate, asOfMs: best.tMs } : { rate8h: null, asOfMs: null };
}

/** Kalshi crypto/metals funding clocks: 04:00, 12:00, 20:00 UTC. */
export function nextKalshiFundingMs(decideMs: number): number {
  const d = new Date(decideMs);
  for (let add = 0; add < 3; add++) {
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add);
    for (const h of [4, 12, 20]) {
      const t = midnight + h * 3_600_000;
      if (t > decideMs) return t;
    }
  }
  return decideMs + 8 * 3_600_000;
}

/** 15 one-minute prints, each on its minute, or the bucket is incomplete and is not a bar. */
export function to15Report(m1: Candle[], upToMs: number): { bars: Candle[]; incomplete: { t: number; minutes: number; reason: string }[] } {
  const g = new Map<number, Map<number, Candle>>();
  for (const k of m1) {
    if (k.t + 60_000 > upToMs) break;
    if (k.t % 60_000 !== 0) continue;
    const b = Math.floor(k.t / 900_000) * 900_000;
    if (b + 900_000 > upToMs) continue;
    const slot = g.get(b) ?? new Map<number, Candle>();
    slot.set(k.t, k);
    g.set(b, slot);
  }
  const bars: Candle[] = [];
  const incomplete: { t: number; minutes: number; reason: string }[] = [];
  for (const [t, slot] of [...g.entries()].sort((a, b) => a[0] - b[0])) {
    const expected = Array.from({ length: 15 }, (_, i) => t + i * 60_000);
    if (expected.some((ts) => !slot.has(ts))) {
      incomplete.push({ t, minutes: slot.size, reason: `incomplete 15m bar: ${slot.size}/15 aligned minutes` });
      continue;
    }
    const ks = expected.map((ts) => slot.get(ts)!);
    bars.push({ t, o: ks[0].o, h: Math.max(...ks.map((k) => k.h)), l: Math.min(...ks.map((k) => k.l)), c: ks.at(-1)!.c, v: ks.reduce((s, k) => s + (k.v ?? 0), 0) });
  }
  return { bars, incomplete };
}

export function to15(m1: Candle[], upToMs: number): Candle[] {
  return to15Report(m1, upToMs).bars;
}

export function simulate(d: SimData, cfg: SimCfg): SimResult {
  const prof: Profile = aggressiveProfile(cfg.riskPct);
  const tick = d.market.tick; const slip = cfg.slipTicks * tick;
  let equity = cfg.startEquity, peak = equity, maxDd = 0, signals = 0, misses = 0, inMarketMin = 0, liqs = 0;
  const trades: SimTrade[] = [];
  const m1 = d.m1; const idxOf = new Map(m1.map((k, i) => [k.t, i]));
  const built = to15Report(m1, Infinity);
  const all15 = built.bars;
  let busyUntil = 0;
  for (let j = 60; j < all15.length; j++) {
    const decideMs = all15[j].t + 900_000; // 15m bar closed
    if (decideMs < busyUntil) continue;
    const b15 = all15.slice(Math.max(0, j - 119), j + 1);
    const b1h = d.h1.filter((h) => h.t + 3_600_000 <= decideMs).slice(-230);
    const close = b15.at(-1)!.c;
    const half = Math.max(tick / 2, d.spreadHalf);
    const bb = Math.floor((close - half) / tick + 1e-9) * tick, ba = Math.ceil((close + half) / tick - 1e-9) * tick;
    const book = { bids: [[bb, 0]] as [number, number][], asks: [[ba, 0]] as [number, number][], bestBid: +bb.toFixed(6), bestAsk: +ba.toFixed(6) };
    const known = fundingAsOf(d.funding, decideMs);
    let best: ReturnType<typeof buildPerpsCandidate> | null = null;
    const quals: ReturnType<typeof buildPerpsCandidate>[] = [];
    for (const dir of ["long", "short"] as const) {
      const c = buildPerpsCandidate({ market: { ...d.market, tick }, book, b15, b1h, dir, makerRate: d.maker, takerRate: d.taker, fundingRate8h: known.rate8h, nextFundingMs: nextKalshiFundingMs(decideMs), observedMs: decideMs, decisionMs: decideMs, receivedMs: decideMs, bookKind: "synthetic_candle", params: { riskUsd: cfg.riskPct * equity, maxNotionalUsd: Math.max(100, equity), macroClear: cfg.macroClear?.(decideMs) ?? false } });
      const ok = c.gates.data_ready.pass && c.gates.setup.pass && c.gates.funding.pass && (cfg.gate === "strict9" ? c.gates.confluence_9.pass : c.score >= 7) && c.stop != null;
      if (ok) quals.push(c);
      if (ok && (!best || c.score > best.score)) best = c;
    }
    if (best && cfg.select) {
      const pick = cfg.select({ ticker: d.market.ticker, decideMs, b15, quals: quals.map((q) => ({ dir: q.dir, setup: q.setup, score: q.score, entry: q.entry!, stop: q.stop!, winNet: q.payoff.winUsdNet, lossNet: q.payoff.lossUsdNet })) });
      best = pick ? quals.find((q) => q.dir === pick) ?? null : null;
    }
    if (!best) continue;
    signals++;
    const long = best.dir === "long";
    const i0 = idxOf.get(decideMs); if (i0 == null) continue;
    // ---- entry fill ----
    let entry: number | null = null, fillIdx = -1, frac = 1;
    if (cfg.entry === "taker") { const nb = m1[i0]; entry = long ? nb.o + d.spreadHalf + slip : nb.o - d.spreadHalf - slip; fillIdx = i0; }
    else {
      const lim = best.entry!;
      for (let k = i0; k < Math.min(m1.length, i0 + cfg.makerWaitBars); k++) {
        const through = long ? lim - m1[k].l : m1[k].h - lim;
        if (through >= tick) { entry = lim; fillIdx = k; frac = through >= cfg.fullFillTicks * tick ? 1 : cfg.partialFrac; break; }
      }
      if (entry == null) { misses++; continue; }
    }
    const r0 = Math.abs(best.entry! - best.stop!);
    const stop = long ? entry - r0 : entry + r0;
    const fundAhead = known.rate8h == null ? 0 : (long ? 1 : -1) * known.rate8h * (cfg.maxHoldMin / 60 / 8);
    const sz = sizePosition({ profile: prof, equityUsd: equity, spec: d.spec, ticker: d.market.ticker, group: d.group, dir: best.dir, entry, stop, feeRateIn: cfg.entry === "maker" ? d.maker : d.taker, feeRateOut: d.taker, slipPerContract: slip, fundingPctOverHold: fundAhead });
    const qty = Math.floor(sz.qty * frac);
    if (qty < 1) continue;
    const plan: ManagePlan = { dir: best.dir, qty, entry, stop, t1: long ? entry + r0 : entry - r0, t2: long ? entry + 2 * r0 : entry - 2 * r0, partialFrac: 0.5, trailR: 1, maxHoldMs: cfg.maxHoldMin * 60_000 };
    let st = startState(plan);
    const liqPx = sz.liq?.liquidationPrice ?? null;
    let k = fillIdx + (cfg.entry === "maker" ? 1 : 0);
    if (cfg.entry === "maker") st = stepBar(plan, st, m1[fillIdx], m1[fillIdx].t, slip); // the fill bar itself can stop us out
    let liquidated = false;
    for (; k < m1.length && !st.closed; k++) {
      if (liqPx != null && (long ? m1[k].l <= liqPx : m1[k].h >= liqPx) && (long ? liqPx > st.stop : liqPx < st.stop)) { liquidated = true; }
      st = stepBar(plan, st, m1[k], m1[fillIdx].t, slip);
    }
    if (!st.closed) continue; // ran out of data: drop (no mark-to-market fiction)
    const gapPastLiq = liqPx != null && st.exits.some((e) => e.reason === "gap_stop" && (long ? e.price <= liqPx : e.price >= liqPx));
    if (liquidated || gapPastLiq) liqs++;
    const endMs = st.exits.at(-1)!.tMs + 60_000;
    const entryFee = qty * entry * (cfg.entry === "maker" ? d.maker : d.taker);
    const exitFees = st.exits.reduce((s, e) => s + e.qty * e.price * (e.taker ? d.taker : d.maker), 0);
    const fund = d.funding.filter((f) => f.tMs > m1[fillIdx].t && f.tMs <= endMs).reduce((s, f) => s + (long ? -1 : 1) * f.rate * qty * entry, 0);
    const net = st.realized - entryFee - exitFees + fund;
    equity += net; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak);
    const hold = (endMs - m1[fillIdx].t) / 60_000; inMarketMin += hold;
    trades.push({ t: m1[fillIdx].t, dir: best.dir, setup: best.setup, score: best.score, entry, stop, qty, notional: +(qty * entry).toFixed(2), lev: +((qty * entry) / (equity - net)).toFixed(2), filledFrac: frac, exits: st.exits.map((e) => `${e.reason}@${e.price.toFixed(4)}x${e.qty}`).join(" "), gross: +st.realized.toFixed(4), fees: +(entryFee + exitFees).toFixed(4), funding: +fund.toFixed(4), fundingRateAtDecision: known.rate8h, net: +net.toFixed(4), holdMin: hold, equityAfter: +equity.toFixed(2), executionClass: "candle_proxy_not_a_fill" });
    busyUntil = endMs;
    if (equity <= 0) break;
  }
  const wins = trades.filter((t) => t.net > 0), losses = trades.filter((t) => t.net <= 0);
  const spanMin = m1.length ? (m1.at(-1)!.t - m1[0].t) / 60_000 : 1;
  return {
    cfg: cfg.name, market: d.market.ticker, signals, makerMisses: misses, trades, netUsd: +(equity - cfg.startEquity).toFixed(2), endEquity: +equity.toFixed(2), maxDdPct: +(maxDd * 100).toFixed(1),
    winRate: trades.length ? +(wins.length / trades.length).toFixed(3) : null, avgWin: wins.length ? +(wins.reduce((s, t) => s + t.net, 0) / wins.length).toFixed(2) : null,
    avgLoss: losses.length ? +(losses.reduce((s, t) => s + t.net, 0) / losses.length).toFixed(2) : null, exposurePct: +((inMarketMin / spanMin) * 100).toFixed(1),
    avgLev: trades.length ? +(trades.reduce((s, t) => s + t.lev, 0) / trades.length).toFixed(2) : null, liquidations: liqs, incomplete15m: built.incomplete.length, label: "CANDLE_ONLY_NOT_EXECUTABLE",
  };
}

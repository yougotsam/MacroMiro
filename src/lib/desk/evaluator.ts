/**
 * One series, one decision. The side comes from fresh-law.ts.
 * A settlement chance is not an entry. This file does not send.
 */
import {
  BAR_MAX_AGE_MS,
  BOOK_MAX_AGE_MS,
  INDEX_MAX_AGE_MS,
  MAKER_MIN_EDGE,
  MIN_SECONDS_LEFT,
  MODEL_REV,
  MODEL_VERSION,
  REFERENCE,
  type Series,
  calibratorPath,
} from "./config";
import { loadCalibrator, type Approval, type Calibrator } from "./approval";
import { minuteBars, type FeatureSnapshot } from "./features";
import { orderFee, type FeeInfo } from "./fees";
import { freshCall } from "./fresh-law";
import { guardVerdict } from "./guard";
import { type Feeds } from "./feeds";
import { type Book, type Candidate, sizeFor } from "./gate";
import { intelligenceLogit, readIntelControls } from "./intelligence";
import { macroGate, type MacroGate } from "./macro-calendar";
import { type Evidence } from "./sniper";
import { type MoveGuard, type GuardState } from "./guard";
import type { Market } from "./kalshi-read";
import type { Decision } from "./ledger";

export type SeriesEval = {
  series: Series;
  market: Market | null;
  book: Book | null;
  pBase: number | null;
  p: number | null;
  shift: number;
  sigma: number | null;
  spot: number | null;
  indexAge: number | null;
  feats: FeatureSnapshot | null;
  sniper: { long: Evidence; short: Evidence } | null;
  best: Candidate | null;
  /** what the gate would have done while a release/safety gate (uncalibrated model, macro calendar) blocks it — logged, never sent */
  shadow: Candidate | null;
  macro: MacroGate | null;
  failed: string | null;
  quotes: Record<string, number | null> | null;
  tte: number | null;
  shock: number;
  lockFrac: number;
  guard: GuardState;
  makerOk: boolean;
  makerMinEdge: number;
  minPrice: number;
  budget: number;
  /** round-3 approval (calibrated P + conservative EV); null when the gate never produced a candidate */
  approval: Approval | null;
  timing: { policy: string; bucket: string | null } | null;
  /** Which added strategy agreed, if the 1-minute list was quiet. Null when none did. */
  strategy: "FIB_RETRACE" | "EMA_PULLBACK" | null;
};

export class Evaluator {
  readonly sigmaBy = new Map<string, number>();
  private cal: { c: Calibrator | null; at: number } = { c: null, at: -Infinity };
  constructor(private feeds: Feeds, private guard: MoveGuard, private calPath: () => string = calibratorPath) {}

  /** Approved calibrator for this model version (re-read at most once a minute). */
  calibrator(now: number): Calibrator | null {
    if (now - this.cal.at > 60_000) this.cal = { c: loadCalibrator(this.calPath(), `${MODEL_VERSION}+${MODEL_REV}`), at: now };
    return this.cal.c;
  }

  evaluate(series: Series, m: Market | null, book: Book | null, fee: FeeInfo | null, now: number, exOk: boolean, budget: number): SeriesEval {
    const ref = REFERENCE[series];
    const out: SeriesEval = {
      series, market: m, book, pBase: null, p: null, shift: 0, sigma: null, spot: null, indexAge: null, feats: null, sniper: null, best: null, shadow: null, macro: null, failed: null, quotes: null,
      tte: m ? (m.closeMs - now) / 1000 : null, shock: 0, lockFrac: 0, guard: this.guard.state(series, now), makerOk: false, makerMinEdge: MAKER_MIN_EDGE, minPrice: 0, budget,
      approval: null, timing: null, strategy: null,
    };
    const fail = (g: string) => ((out.failed = g), out);
    if (!exOk) return fail("G0_exchange_paused");
    // FAIL-CLOSED macro calendar: evaluated now, enforced after pricing so the shadow ledger keeps the would-be trade.
    const macro = macroGate(now);
    out.macro = macro;
    if (!m) return fail("G1_no_open_market");
    if (m.strikeType !== "greater_or_equal") return fail("G1_strike_type");
    if ((m.exchangeIndex !== 0 && m.exchangeIndex !== 2) || m.priceRanges.length === 0) return fail("G1_wrong_shard_or_price_grid");
    const ruleOk = ref.kind === "rti60" ? m.rules.includes(ref.index.replace("USD_RTI", "USDRTI")) || m.rules.includes(ref.index) : /pyth|gold|silver|wti|oil|gbp\/usd|eur\/usd|usd\/jpy/i.test(m.rules);
    if (!ruleOk) return fail("G1_rules_mismatch");
    const left = (m.closeMs - now) / 1000;
    if (left < MIN_SECONDS_LEFT) return fail("G1_too_close_to_close");
    const last = this.feeds.last(ref.index);
    out.indexAge = last ? now - last.t : null;
    if (!last || last.t > now + 500 || now - last.t > INDEX_MAX_AGE_MS ||
        now - last.recv > INDEX_MAX_AGE_MS) return fail("G1_index_stale");
    out.spot = last.v;
    if (!book) return fail("G1_no_book");
    if (book.ts > now + 500 || now - book.ts > BOOK_MAX_AGE_MS) return fail("G1_book_stale");
    const bars = minuteBars(this.feeds.prints(ref.index, now - 210 * 60_000), now);
    const lastBar = bars[bars.length - 1];
    if (!lastBar || now - (lastBar.t * 60_000 + 60_000) > BAR_MAX_AGE_MS) return fail("G1_bars_stale");
    const fresh = freshCall(bars.map((b) => b.c));
    if (!fresh) return fail("FRESH_no_setup");
    if (!fee || fee.feeType !== "quadratic" || !(fee.multiplier > 0)) return fail("FRESH_fee_unknown");
    const bid = fresh.side === "yes" ? book.yesBid : book.noBid;
    const other = fresh.side === "yes" ? book.noBid : book.yesBid;
    const ask = other ? Math.round((1 - other.price) * 10_000) / 10_000 : null;
    if (!bid || !(bid.price > 0) || !(bid.price < 1)) return fail("FRESH_no_bid");
    if (ask != null && ask - bid.price > 0.04) return fail("FRESH_spread");
    const count = sizeFor(bid.price, true, fee, budget);
    if (count < 1) return fail("FRESH_size");
    const paid = orderFee(count, bid.price, true, fee);
    const quote = { side: fresh.side, mode: "maker" as const, price: bid.price, count, fee: paid, feePer: paid / count, edge: 0, edgeBase: 0, pSide: 0.5 };
    out.quotes = { yes_bid: book.yesBid?.price ?? null, no_bid: book.noBid?.price ?? null };
    const verdict = guardVerdict({ side: fresh.side, cash: 0, dayWorst: 0, kept: false, calibratedP: null });
    out.shadow = quote;
    out.best = null;
    return fail(`GUARD_${verdict.why}`);
  }
}

export function confluenceLog(sniper: { long: Evidence; short: Evidence } | null) {
  if (!sniper) return null;
  const side = (e: Evidence) => ({ score: e.score, setup: e.setup, eligible: e.eligible, points: e.points, missing: e.missing });
  const block = sniper.long.missing[0] ?? sniper.short.missing[0] ?? null;
  return { long: side(sniper.long), short: side(sniper.short), block };
}

export function decisionRowOf(e: SeriesEval, action: Decision["action"], fee: FeeInfo | null, now: number, order?: Decision["order"]): Decision {
  return {
    ts: new Date(now).toISOString(),
    ticker: e.market?.ticker ?? null,
    series: e.series,
    close: e.market ? new Date(e.market.closeMs).toISOString() : null,
    tte_s: e.market ? Math.round((e.market.closeMs - now) / 1000) : null,
    strike: e.market?.strike ?? null,
    spot: e.spot,
    index_age_ms: e.indexAge,
    book_age_ms: e.book ? now - e.book.ts : null,
    sigma: e.sigma,
    p_base: e.pBase,
    feature_shift: e.shift,
    p: e.p,
    quotes: e.quotes,
    depth: e.book ? { yes_bid_size: e.book.yesBid?.size ?? null, no_bid_size: e.book.noBid?.size ?? null } : null,
    fee_type: fee?.feeType ?? null,
    fee_multiplier: fee?.multiplier ?? null,
    best: e.best ? { side: e.best.side, mode: e.best.mode, price: e.best.price, count: e.best.count, fee: e.best.fee, edge: Number(e.best.edge.toFixed(4)), edge_base: Number(e.best.edgeBase.toFixed(4)) } : null,
    shadow_best: e.shadow ? { side: e.shadow.side, mode: e.shadow.mode, price: e.shadow.price, count: e.shadow.count, fee: e.shadow.fee, edge: Number(e.shadow.edge.toFixed(4)), edge_base: Number(e.shadow.edgeBase.toFixed(4)) } : null,
    action,
    failed_gate: e.failed,
    features: e.feats ? { ...e.feats.groups, group_votes: e.feats.groups, flow: e.feats.flow, score: e.feats.score, ema7: e.feats.ema7, ema14: e.feats.ema14, ema50: e.feats.ema50, ema200: e.feats.ema200, rsi14: e.feats.rsi14, candle: e.feats.candle, structure: e.feats.structure } : null,
    model: `${MODEL_VERSION}+${MODEL_REV}`,
    order,
    approval: e.approval ? { ok: e.approval.ok, why: e.approval.why, p_cal: e.approval.pCal, ev_per_contract: e.approval.evPerContract, cushion: e.approval.cushion } : null,
    timing: e.timing,
    strategy: e.strategy,
    confluence: confluenceLog(e.sniper),
    guard: { shock: Number(e.shock.toFixed(4)), maker_min_edge: Number(e.makerMinEdge.toFixed(4)), lock_frac: Number(e.lockFrac.toFixed(3)), move_z: Number(e.guard.z.toFixed(2)), cooling: e.guard.cooling, maker_ok: e.makerOk, budget: e.budget, min_price: e.minPrice },
    intel: {
      logit: Number(intelligenceLogit(e.series, now).toFixed(4)),
      controls: readIntelControls(),
      passed_gate: Boolean(e.best),
      requested: [],
    },
  };
}

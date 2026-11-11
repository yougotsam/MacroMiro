/**
 * One market, one decision. P(YES) must correspond to the actual Kalshi
 * settlement index, strike and close time. The signal checklist predicts the
 * next 15-minute price-bar direction: it is only directional context and NEVER
 * the probability of the venue contract settling YES.
 * This evaluator does not send orders. Approval and the OMS remain independent.
 */
import {
  APPROVAL_CUSHION,
  APPROVAL_POLICY_ENFORCED,
  BAR_MAX_AGE_MS,
  BOOK_MAX_AGE_MS,
  INDEX_MAX_AGE_MS,
  MAKER_MIN_EDGE,
  MIN_SECONDS_LEFT,
  MODEL_REV,
  MODEL_VERSION,
  REFERENCE,
  TIMING_POLICY,
  type Series,
  calibratorPath,
} from "./config";
import { approve, loadCalibrator, TIMING_POLICIES, type Approval, type Calibrator } from "./approval";
import { estimateContractSettlement } from "./contract-quote";
import { minuteBars, type FeatureSnapshot } from "./features";
import { orderFee, type FeeInfo } from "./fees";
import { guardVerdict } from "./guard";
import { type Feeds } from "./feeds";
import { type Book, type Candidate, scoreSides, sizeFor } from "./gate";
import { readIntelControls, readIntelLogit } from "./intel-gate";
import { preTrade, type PreTrade } from "@/lib/signal/checklist";
import { LiveBars } from "@/lib/signal/live-bars";
import { readNewsDocs, releaseTimes } from "@/lib/signal/news";
import { ASSET_OF_SERIES, loadSignalModel, readNewsHistory } from "@/lib/signal/store";
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
  /** the full pre-trade checklist for this tick (null before the market/book checks pass) */
  check: PreTrade | null;
};

export type AccountView = { cash: number; dayWorst: number; lossesInARow: number };

export class Evaluator {
  readonly sigmaBy = new Map<string, number>();
  private cal: { c: Calibrator | null; at: number } = { c: null, at: -Infinity };
  constructor(
    private feeds: Feeds,
    private guard: MoveGuard,
    private calPath: () => string = calibratorPath,
    readonly bars: LiveBars = new LiveBars(),
  ) {}

  /** Approved calibrator for this model version (re-read at most once a minute). */
  calibrator(now: number): Calibrator | null {
    if (now - this.cal.at > 60_000) this.cal = { c: loadCalibrator(this.calPath(), `${MODEL_VERSION}+${MODEL_REV}+contract-settlement-v1`), at: now };
    return this.cal.c;
  }

  evaluate(series: Series, m: Market | null, book: Book | null, fee: FeeInfo | null, now: number, exOk: boolean, budget: number, acct: AccountView | null = null): SeriesEval {
    const ref = REFERENCE[series];
    const out: SeriesEval = {
      series, market: m, book, pBase: null, p: null, shift: 0, sigma: null, spot: null, indexAge: null, feats: null, sniper: null, best: null, shadow: null, macro: null, failed: null, quotes: null,
      tte: m ? (m.closeMs - now) / 1000 : null, shock: 0, lockFrac: 0, guard: this.guard.state(series, now), makerOk: false, makerMinEdge: MAKER_MIN_EDGE, minPrice: 0, budget,
      approval: null, timing: null, strategy: null, check: null,
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
    const asset = ASSET_OF_SERIES[series];
    if (!asset) return fail("SIGNAL_no_measured_asset");
    void this.bars.refresh(asset, now);
    if (!fee || fee.feeType !== "quadratic" || !(fee.multiplier > 0)) return fail("SIGNAL_fee_unknown");
    out.quotes = { yes_bid: book.yesBid?.price ?? null, no_bid: book.noBid?.price ?? null };
    const bidOf = (side: "yes" | "no") => (side === "yes" ? book.yesBid : book.noBid);
    const check = preTrade({
      asset,
      product: "prediction",
      bars: this.bars.get(asset),
      now,
      releases: releaseTimes(undefined, now),
      docs: readNewsDocs(),
      hist: readNewsHistory(asset, now),
      file: loadSignalModel(now),
      // The bar-direction model is context only, not a settlement probability.
      priceFor: (side) => {
        const bid = bidOf(side);
        if (!bid || !(bid.price > 0) || !(bid.price < 1)) return null;
        const c = Math.max(1, sizeFor(bid.price, true, fee, Math.max(budget, bid.price)));
        return { price: bid.price, feePer: orderFee(c, bid.price, true, fee) / c };
      },
    });
    out.check = check;

    // Use the contract's authoritative settlement index, strike and close.
    // Never substitute check.pUp or check.pSide (next-bar up/down proxy).
    const settlement = estimateContractSettlement(this.feeds, series, m, now);
    if (!settlement.ok) return fail(`SETTLEMENT_${settlement.why}`);
    out.pBase = settlement.pYes;
    out.p = settlement.pYes;
    out.sigma = settlement.sigma;
    this.sigmaBy.set(series, settlement.sigma);
    const priced = scoreSides(settlement.pYes, settlement.pYes, book, fee, {
      allowMaker: true,
      allowTaker: true,
      budget,
      priceRanges: m.priceRanges,
    });
    out.quotes = priced.quotes;
    const candidate = priced.best;
    if (!candidate) return fail(`SETTLEMENT_${priced.failed ?? "no_executable_edge"}`);
    out.shadow = candidate;
    if (macro.blocked) return fail(`MACRO_${macro.reason ?? "release_window"}`);

    // The older next-candle model may veto an out-of-regime contract candidate.
    // Its training verdict or confidence can never authorize a YES/NO contract.
    const contextKept = check.steps.some((step) => step.name === "Measured verdict (#124)" && step.state === "pass");
    if (!contextKept || check.pUp == null) return fail("SIGNAL_directional_context_unavailable");
    const candidateBias = candidate.side === "yes" ? "long" : "short";
    if (check.bias !== candidateBias) return fail("SIGNAL_direction_disagrees_with_settlement");

    const approval = approve({
      pYesRaw: settlement.pYes,
      calibrator: this.calibrator(now),
      candidate,
      tteSec: left,
      policy: TIMING_POLICIES[TIMING_POLICY],
      cushion: APPROVAL_CUSHION,
    });
    out.approval = approval;
    out.timing = { policy: TIMING_POLICY, bucket: approval.bucket };
    if (!APPROVAL_POLICY_ENFORCED) return fail("APPROVAL_policy_disabled");
    if (!approval.ok || approval.pCal == null)
      return fail(`APPROVAL_${approval.why}`);
    const pSide = candidate.side === "yes" ? approval.pCal : 1 - approval.pCal;
    const verdict = guardVerdict({
      side: candidate.side,
      cash: acct?.cash ?? 0,
      dayWorst: acct?.dayWorst ?? 0,
      kept: true,
      calibratedP: pSide,
      lossesInARow: acct?.lossesInARow ?? 0,
    });
    if (!verdict.fire) return fail(`GUARD_${verdict.why.replace(/ /g, "_")}`);
    out.best = {
      ...candidate,
      pSide,
      edge: approval.evPerContract ?? candidate.edge,
    };
    out.shadow = null;
    return out;
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
    checklist: e.check ? { bias: e.check.bias, p_up: e.check.pUp, edge: e.check.edge, fire: e.check.fire, why: e.check.why, reasons: e.check.reasons, steps: e.check.steps.map((x) => `${x.n}.${x.name}:${x.state}`), mirofish: e.check.news.mirofishState, vector: e.check.vector } : null,
    confluence: confluenceLog(e.sniper),
    guard: { shock: Number(e.shock.toFixed(4)), maker_min_edge: Number(e.makerMinEdge.toFixed(4)), lock_frac: Number(e.lockFrac.toFixed(3)), move_z: Number(e.guard.z.toFixed(2)), cooling: e.guard.cooling, maker_ok: e.makerOk, budget: e.budget, min_price: e.minPrice },
    intel: {
      logit: Number(readIntelLogit(e.series, now).toFixed(4)),
      controls: readIntelControls(),
      passed_gate: Boolean(e.best),
      requested: [],
    },
  };
}

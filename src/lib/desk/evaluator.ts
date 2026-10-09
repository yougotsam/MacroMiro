/**
 * Pure-ish evaluation of one series (no OMS, no order path): settlement P → features → execution guard → gate →
 * timing policy → approval (calibrated P + conservative EV) → macro / release gates. Shared by the trading engine and
 * the read-only observation collector (scripts/desk-observe.ts), which must never be able to send an order —
 * this module therefore imports nothing from oms.ts or the signed order transport (observe.test.ts enforces it).
 */
import {
  APPROVAL_CUSHION,
  APPROVAL_POLICY_ENFORCED,
  BAR_MAX_AGE_MS,
  BOOK_MAX_AGE_MS,
  CALIBRATED_MODEL_APPROVED,
  INDEX_MAX_AGE_MS,
  MAKER_MIN_EDGE,
  MIN_SECONDS_LEFT,
  MIN_VOL_SAMPLES,
  MODEL_REV,
  MODEL_VERSION,
  REFERENCE,
  type Series,
  TIMING_POLICY,
  calibratorPath,
} from "./config";
import { approve, bucketFor, loadCalibrator, TIMING_POLICIES, type Approval, type Calibrator } from "./approval";
import { features, featureShift, minuteBars, type FeatureSnapshot } from "./features";
import type { FeeInfo } from "./fees";
import { type Feeds, officialMatches } from "./feeds";
import { type Book, type Candidate, scoreSides } from "./gate";
import { macroGate, type MacroGate } from "./macro-calendar";
import { resampleComplete, evaluateSniper, type Evidence } from "./sniper";
import { type MoveGuard, makerWindowOk, minPriceFor, shockOf, type GuardState } from "./guard";
import type { Market } from "./kalshi-read";
import type { Decision } from "./ledger";
import { SIGMA_FLOOR, clampP, cryptoProb, goldProb, sigmaFromPrints } from "./settlement";

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
      approval: null, timing: null,
    };
    const fail = (g: string) => ((out.failed = g), out);
    if (!exOk) return fail("G0_exchange_paused");
    // FAIL-CLOSED macro calendar: evaluated now, enforced after pricing so the shadow ledger keeps the would-be trade.
    const macro = macroGate(now);
    out.macro = macro;
    if (!m) return fail("G1_no_open_market");
    if (m.strikeType !== "greater_or_equal") return fail("G1_strike_type");
    if (m.exchangeIndex !== 2 || m.priceRanges.length === 0) return fail("G1_wrong_shard_or_price_grid");
    const ruleOk = ref.kind === "rti60" ? m.rules.includes(ref.index.replace("USD_RTI", "USDRTI")) || m.rules.includes(ref.index) : /pyth|gold/i.test(m.rules) || m.rules.toLowerCase().includes("gold");
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
    const prints = this.feeds.prints(ref.index, now - 3600_000);
    const bars = minuteBars(prints, now);
    const lastBar = bars[bars.length - 1];
    if (!lastBar || now - (lastBar.t * 60_000 + 60_000) > BAR_MAX_AGE_MS) return fail("G1_bars_stale");
    const sig = sigmaFromPrints(prints, now, SIGMA_FLOOR[ref.index] ?? 2e-5);
    if (sig.sigma == null || sig.n < MIN_VOL_SAMPLES) return fail("G1_vol_warmup");
    out.sigma = sig.sigma;
    this.sigmaBy.set(series, sig.sigma);
    const windowPrints = ref.kind === "rti60" ?
      this.feeds.windowMap(ref.index, m.closeMs - 59_000, m.closeMs + 1000) :
      new Map<number, number>();
    const afterWindowStart = ref.kind === "rti60" &&
      last.t >= m.closeMs - 59_000 && last.t <= m.closeMs;
    const official = afterWindowStart ? this.feeds.lastOfficialAverage(ref.index) : null;
    if (afterWindowStart) {
      if (!officialMatches(official, last.t, m.closeMs)) {
        return fail("G1_official_settlement_accumulator_missing_or_mismatched");
      }
    }
    const pAt = (v: number) =>
      ref.kind === "rti60"
        ? cryptoProb({
            closeMs: m.closeMs, strike: m.strike, dp: ref.dp,
            last: { t: last.t, v }, windowPrints, sigma: sig.sigma!,
            official: official ? { value: official.value, count: official.windowSize, t: official.t } : undefined,
          })
        : goldProb({ closeMs: m.closeMs, strike: m.strike, dp: ref.dp, last: { t: last.t, v }, sigma: sig.sigma! });
    // On a packet gap, the official aggregate (if matched) is authoritative.
    // Any divergence in a complete local window is rejected by cryptoProb().
    const model = pAt(last.v);
    out.lockFrac = ref.kind === "rti60" ? model.printed / 60 : 0;
    out.shock = shockOf((v) => clampP(pAt(v).p), last.v, sig.sigma);
    const pBase = clampP(model.p);
    const feats = features(bars);
    const shift = featureShift(pBase, feats.score);
    out.pBase = pBase;
    out.feats = feats;
    // Current CF index 1m candles do not have real exchange volume. These are
    // RESEARCH observations only; unavailable 1h/flow conditions remain missing.
    const researchBars = bars.map((b) => ({ ...b, t: b.t * 60_000 }));
    const b15 = resampleComplete(researchBars, 15);
    const b1h = resampleComplete(researchBars, 60);
    out.sniper = {
      long: evaluateSniper(b15, b1h, "long", macro.available && !macro.blocked),
      short: evaluateSniper(b15, b1h, "short", macro.available && !macro.blocked),
    };
    out.shift = shift;
    out.p = clampP(pBase + shift);
    // execution guard
    out.guard = this.guard.observe(series, prints.slice(-30), sig.sigma, now);
    out.makerOk = makerWindowOk(left, out.lockFrac, ref.kind);
    out.makerMinEdge = MAKER_MIN_EDGE + out.shock;
    out.minPrice = minPriceFor(left);
    if (!fee || fee.feeType !== "quadratic" || !Number.isFinite(fee.multiplier) || fee.multiplier <= 0)
      return fail("G1_fee_unknown_or_unsupported");
    if (out.guard.cooling) return fail(`G2_fast_move_cooldown_${out.guard.dir}`);
    if (budget <= 0) return fail("G2_no_room");
    // time-to-expiry policy ("current" reproduces the old timing exactly; see approval.ts)
    const policy = TIMING_POLICIES[TIMING_POLICY];
    const bucket = bucketFor(policy, left);
    out.timing = { policy: policy.id, bucket: bucket?.name ?? null };
    if (APPROVAL_POLICY_ENFORCED && (!bucket || !bucket.allow)) return fail(`G2_timing_${bucket?.name ?? "none"}`);
    if (APPROVAL_POLICY_ENFORCED && bucket) {
      out.makerOk = out.makerOk && bucket.allowMaker;
      out.minPrice = Math.max(out.minPrice, bucket.minPrice);
    }
    const g = scoreSides(out.p, pBase, book, fee, { allowMaker: out.makerOk, allowTaker: APPROVAL_POLICY_ENFORCED ? (bucket?.allowTaker ?? false) : true, budget, makerMinEdge: out.makerMinEdge, minPrice: out.minPrice, priceRanges: m.priceRanges });
    out.quotes = g.quotes;
    out.best = g.best;
    if (!g.best) return fail(`G2_${g.failed}${out.makerOk ? "" : "_maker_off_final_seconds"}`);
    // approval: calibrated P + conservative EV after fees and cushion at the executable price (approval.ts)
    out.approval = approve({ pYesRaw: out.p, calibrator: this.calibrator(now), candidate: g.best, tteSec: left, policy, cushion: APPROVAL_CUSHION });
    // Scheduled macro release, or calendar missing/stale/unparseable: no entry (fail closed).
    if (macro.blocked) {
      out.shadow = out.best;
      out.best = null;
      return fail(`G0_${macro.reason ?? "macro_calendar_unavailable"}`);
    }
    if (APPROVAL_POLICY_ENFORCED && !out.approval.ok) {
      out.shadow = out.best;
      out.best = null;
      return fail(`G3_approval_${out.approval.why}`);
    }
    // A model must be independently calibrated before production eligibility.
    if (!CALIBRATED_MODEL_APPROVED) {
      out.shadow = out.best;
      out.best = null;
      return fail("G3_uncalibrated_model_shadow_only");
    }
    return out;
  }
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
    features: e.feats ? { ...e.feats.groups, score: e.feats.score, ema7: e.feats.ema7, ema14: e.feats.ema14, ema50: e.feats.ema50, rsi14: e.feats.rsi14, candle: e.feats.candle, structure: e.feats.structure } : null,
    model: `${MODEL_VERSION}+${MODEL_REV}`,
    order,
    approval: e.approval ? { ok: e.approval.ok, why: e.approval.why, p_cal: e.approval.pCal, ev_per_contract: e.approval.evPerContract, cushion: e.approval.cushion } : null,
    timing: e.timing,
    confluence: e.sniper ? { long: { score: e.sniper.long.score, setup: e.sniper.long.setup, eligible: e.sniper.long.eligible }, short: { score: e.sniper.short.score, setup: e.sniper.short.setup, eligible: e.sniper.short.eligible } } : null,
    guard: { shock: Number(e.shock.toFixed(4)), maker_min_edge: Number(e.makerMinEdge.toFixed(4)), lock_frac: Number(e.lockFrac.toFixed(3)), move_z: Number(e.guard.z.toFixed(2)), cooling: e.guard.cooling, maker_ok: e.makerOk, budget: e.budget, min_price: e.minPrice },
  };
}

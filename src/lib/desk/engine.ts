/**
 * Desk engine v1 — the one process that trades. Loop (every 2 s, single-flight):
 *   G0 exchange open (GET /exchange/status) → G1 data fresh (index ≤5 s, book ≤3 s, bars ≤90 s, σ warm)
 *   → settlement P (martingale, 60-print average / Pyth close) → features (±4 pp max)
 *   → YES/NO executable edge (maker-first, taker ≥4¢) → risk engine → OMS (1 order per tick)
 * Every decision is written to the decision ledger; settled outcomes are joined for calibration.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  BAR_MAX_AGE_MS,
  BOOK_MAX_AGE_MS,
  INDEX_MAX_AGE_MS,
  MIN_SECONDS_LEFT,
  MIN_VOL_SAMPLES,
  MODEL_VERSION,
  REFERENCE,
  SERIES,
  type Series,
  dataDir,
} from "./config";
import { features, featureShift, minuteBars, type FeatureSnapshot } from "./features";
import type { FeeInfo } from "./fees";
import { Feeds } from "./feeds";
import { type Book, type Candidate, restingEdge, scoreSides } from "./gate";
import { exchangeStatus, fetchSnapshot, marketResult, openMarket, orderbook, seriesFee, sidePrice, type KOrder, type Market, type Position } from "./kalshi-read";
import { DecisionLedger, type Decision } from "./ledger";
import { Oms } from "./oms";
import { RiskEngine, dayWorstOf, switches, type AccountSnapshot } from "./risk";
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
  best: Candidate | null;
  failed: string | null;
  quotes: Record<string, number | null> | null;
};

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export class Engine {
  feeds = new Feeds(true);
  risk = new RiskEngine();
  oms = new Oms(this.risk);
  ledger = new DecisionLedger();
  private markets = new Map<string, { m: Market | null; at: number }>();
  private fees = new Map<string, { info: FeeInfo; at: number }>();
  private ex = { tradingActive: false, at: 0 };
  private busy = false;
  private tickId = 0;
  private lastOutcomeSweep = 0;
  private snapshot: AccountSnapshot | null = null;
  lastStatus: Record<string, unknown> = {};

  async start() {
    mkdirSync(dataDir(), { recursive: true });
    await this.feeds.bootstrap();
    this.feeds.start();
    await this.oms.reconcilePending().catch(() => 0);
    log("engine started", MODEL_VERSION, "live", switches.live(), "begin", switches.begin(), "arm", switches.arm());
  }

  private async market(series: Series, now: number) {
    const c = this.markets.get(series);
    if (c && c.m && c.m.closeMs > now && now - c.at < 60_000) return c.m;
    if (c && !c.m && now - c.at < 5_000) return null;
    const m = await openMarket(series).catch(() => null);
    this.markets.set(series, { m, at: now });
    return m;
  }

  private async fee(series: Series, now: number): Promise<FeeInfo | null> {
    const c = this.fees.get(series);
    if (c && now - c.at < 3600_000) return c.info;
    try {
      const info = await seriesFee(series);
      this.fees.set(series, { info, at: now });
      return info;
    } catch {
      return c?.info ?? null;
    }
  }

  evaluate(series: Series, m: Market | null, book: Book | null, fee: FeeInfo | null, now: number, exOk: boolean): SeriesEval {
    const ref = REFERENCE[series];
    const out: SeriesEval = { series, market: m, book, pBase: null, p: null, shift: 0, sigma: null, spot: null, indexAge: null, feats: null, best: null, failed: null, quotes: null };
    const fail = (g: string) => ((out.failed = g), out);
    if (!exOk) return fail("G0_exchange_paused");
    if (!m) return fail("G1_no_open_market");
    if (m.strikeType !== "greater_or_equal") return fail("G1_strike_type");
    const ruleOk = ref.kind === "rti60" ? m.rules.includes(ref.index.replace("USD_RTI", "USDRTI")) || m.rules.includes(ref.index) : /pyth|gold/i.test(m.rules) || m.rules.toLowerCase().includes("gold");
    if (!ruleOk) return fail("G1_rules_mismatch");
    const left = (m.closeMs - now) / 1000;
    if (left < MIN_SECONDS_LEFT) return fail("G1_too_close_to_close");
    const last = this.feeds.last(ref.index);
    out.indexAge = last ? now - last.t : null;
    if (!last || now - last.t > INDEX_MAX_AGE_MS) return fail("G1_index_stale");
    out.spot = last.v;
    if (!book) return fail("G1_no_book");
    if (now - book.ts > BOOK_MAX_AGE_MS) return fail("G1_book_stale");
    const prints = this.feeds.prints(ref.index, now - 3600_000);
    const bars = minuteBars(prints, now);
    const lastBar = bars[bars.length - 1];
    if (!lastBar || now - (lastBar.t * 60_000 + 60_000) > BAR_MAX_AGE_MS) return fail("G1_bars_stale");
    const sig = sigmaFromPrints(prints, now, SIGMA_FLOOR[ref.index] ?? 2e-5);
    if (sig.sigma == null || sig.n < MIN_VOL_SAMPLES) return fail("G1_vol_warmup");
    out.sigma = sig.sigma;
    const model =
      ref.kind === "rti60"
        ? cryptoProb({ closeMs: m.closeMs, strike: m.strike, dp: ref.dp, last, windowPrints: this.feeds.windowMap(ref.index, m.closeMs - 60_000, m.closeMs), sigma: sig.sigma })
        : goldProb({ closeMs: m.closeMs, strike: m.strike, dp: ref.dp, last, sigma: sig.sigma });
    const pBase = clampP(model.p);
    const feats = features(bars);
    const shift = featureShift(pBase, feats.score);
    out.pBase = pBase;
    out.feats = feats;
    out.shift = shift;
    out.p = clampP(pBase + shift);
    if (!fee) return fail("G1_fee_unknown");
    const g = scoreSides(out.p, pBase, book, fee, { allowMaker: true, allowTaker: true });
    out.quotes = g.quotes;
    out.best = g.best;
    if (!g.best) return fail(`G2_${g.failed}`);
    return out;
  }

  private decisionRow(e: SeriesEval, action: Decision["action"], fee: FeeInfo | null, now: number, order?: Decision["order"]): Decision {
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
      fee_type: fee?.feeType ?? null,
      best: e.best ? { side: e.best.side, mode: e.best.mode, price: e.best.price, count: e.best.count, fee: e.best.fee, edge: Number(e.best.edge.toFixed(4)), edge_base: Number(e.best.edgeBase.toFixed(4)) } : null,
      action,
      failed_gate: e.failed,
      features: e.feats ? { ...e.feats.groups, score: e.feats.score, ema7: e.feats.ema7, ema14: e.feats.ema14, ema50: e.feats.ema50, rsi14: e.feats.rsi14, candle: e.feats.candle, structure: e.feats.structure } : null,
      model: MODEL_VERSION,
      order,
    };
  }

  /** Cancel desk resting orders whose edge vanished, went stale (>90 s and no longer top), or are about to close. */
  private async manageResting(resting: KOrder[], evals: SeriesEval[], now: number) {
    for (const o of resting) {
      if (!(o.client_order_id ?? "").startsWith("mm1-")) continue; // never touch orders the desk didn't place
      const e = evals.find((x) => x.market?.ticker === o.ticker);
      const side = (o.outcome_side ?? o.side ?? "yes").toLowerCase() === "no" ? "no" : "yes";
      const px = sidePrice(o);
      let why: string | null = null;
      if (!e || !e.market) why = "market gone";
      else if (e.p == null) why = `data gate ${e.failed}`;
      else if (restingEdge(e.p, side, px) < 0) why = `edge gone ${restingEdge(e.p, side, px).toFixed(3)}`; // post needs ≥1¢, keep while ≥0 (hysteresis)
      else if (e.book) {
        const myBid = side === "yes" ? e.book.yesBid : e.book.noBid;
        const age = now - Date.parse(o.created_time ?? new Date(now).toISOString());
        if (myBid && myBid.price > px + 0.015 && age > 90_000) why = "outbid >1¢ for 90s";
      }
      if (why) {
        const st = await this.oms.cancel(o.order_id, o.ticker, o.client_order_id ?? "", why).catch(() => 0);
        if (e) this.ledger.write(this.decisionRow({ ...e, failed: why }, "CANCEL", null, now, { cid: o.client_order_id, orderId: o.order_id, status: `cancel http ${st}` }), now);
        log("CANCEL", o.ticker, side, px, why, st);
      }
    }
  }

  private async sweepOutcomes(now: number) {
    if (now - this.lastOutcomeSweep < 60_000) return;
    this.lastOutcomeSweep = now;
    const done = this.ledger.settledTickers();
    const decided = [...this.ledger.decidedTickers()].filter((t) => !done.has(t));
    for (const t of decided.slice(0, 20)) {
      const r = await marketResult(t).catch(() => null);
      if (r && (r.result === "yes" || r.result === "no")) this.ledger.outcome({ ticker: t, result: r.result, value: r.value });
    }
  }

  async tick() {
    if (this.busy) return; // single-flight tick lock
    this.busy = true;
    const tickId = ++this.tickId;
    const now = Date.now();
    try {
      if (tickId % 5 === 0) {
        this.feeds.flush();
        this.feeds.prune(now);
      }
      if (now - this.ex.at > 10_000) {
        const ex = await exchangeStatus().catch(() => null);
        this.ex = { tradingActive: Boolean(ex?.tradingActive), at: ex ? Date.now() : this.ex.at };
      }
      const exOk = this.ex.tradingActive && now - this.ex.at < 15_000;
      await this.oms.reconcilePending(now).catch(() => 0);
      let resting: KOrder[] = [];
      let positions: Position[] = [];
      try {
        const r = await fetchSnapshot(this.ex, { pendingIntents: this.oms.pendingIntents(now), perTicker: this.oms.perTicker() });
        this.snapshot = r.snap;
        resting = r.resting;
        positions = r.positions;
        this.risk.observe(r.snap);
      } catch (e) {
        this.snapshot = null;
        log("snapshot error", e instanceof Error ? e.message.slice(0, 160) : e);
      }
      const t0 = Date.now();
      const evals = await Promise.all(
        SERIES.map(async (s) => {
          const m = await this.market(s, t0);
          const [book, fee] = await Promise.all([m ? orderbook(m.ticker).catch(() => null) : Promise.resolve(null), this.fee(s, t0)]);
          return { e: this.evaluate(s, m, book, fee, Date.now(), exOk), fee };
        }),
      );
      await this.manageResting(resting, evals.map((x) => x.e), Date.now());

      // pick the best candidate across series; skip tickers where the desk already rests an order or holds the other side
      const busyTickers = new Set(resting.filter((o) => (o.client_order_id ?? "").startsWith("mm1-")).map((o) => o.ticker));
      for (const t of this.oms.recentTickers(Date.now())) busyTickers.add(t);
      const ranked = evals
        .filter((x) => x.e.best && x.e.market)
        .filter((x) => {
          const t = x.e.market!.ticker;
          if (busyTickers.has(t)) return false;
          const pos = positions.find((p) => p.ticker === t);
          if (!pos) return true;
          const held = Number(pos.position_fp ?? 0) > 0 ? "yes" : "no";
          return held === x.e.best!.side; // never buy the opposite side of a held position
        })
        .sort((a, b) => b.e.best!.edge * b.e.best!.count - a.e.best!.edge * a.e.best!.count);

      const now2 = Date.now();
      let sent = 0;
      for (const x of evals) {
        const isPick = ranked[0] === x;
        if (!isPick) {
          const why = x.e.best ? (busyTickers.has(x.e.market!.ticker) ? "G3_already_resting" : "G3_not_best_this_tick") : x.e.failed;
          this.ledger.write(this.decisionRow({ ...x.e, failed: why }, "NO_TRADE", x.fee, now2), now2);
          continue;
        }
        const b = x.e.best!;
        const intent = { product: "event" as const, ticker: x.e.market!.ticker, side: b.side, mode: b.mode, price: b.price, count: b.count, fee: b.fee, tickId };
        const res = await this.oms.submit(intent, this.snapshot);
        if (res.ok) sent += 1;
        this.ledger.write(
          this.decisionRow({ ...x.e, failed: res.ok ? null : res.why }, res.ok ? "BUY" : "REFUSED", x.fee, now2, { cid: res.cid, orderId: res.orderId, status: res.status, fill: res.fill, why: res.why }),
          now2,
        );
        log(res.ok ? "ORDER" : "REFUSED", intent.ticker, b.side, b.mode, b.price, "x", b.count, "edge", b.edge.toFixed(3), res.why, res.status ?? "");
      }
      await this.sweepOutcomes(now2);
      const latched = this.risk.latched(now2);
      this.lastStatus = {
        ts: new Date(now2).toISOString(),
        model: MODEL_VERSION,
        tickId,
        feeds: this.feeds.status,
        exchangeTradingActive: this.ex.tradingActive,
        switches: { live: switches.live(), begin: switches.begin(), arm: switches.arm() },
        latched: latched?.latchReason ?? null,
        snapshot: this.snapshot ? { dayWorst: dayWorstOf(this.snapshot), realized: this.snapshot.realizedToday, openWorst: this.snapshot.openWorst, restWorst: this.snapshot.restWorst, pendingWorst: this.snapshot.pendingWorst, shard2: this.snapshot.shard2Cash } : null,
        sentThisTick: sent,
        series: evals.map(({ e }) => ({ series: e.series, ticker: e.market?.ticker ?? null, tte: e.market ? Math.round((e.market.closeMs - now2) / 1000) : null, p: e.p, pBase: e.pBase, gate: e.failed ?? "PASS", best: e.best ? { side: e.best.side, mode: e.best.mode, price: e.best.price, count: e.best.count, edge: Number(e.best.edge.toFixed(4)) } : null })),
      };
      writeFileSync(`${dataDir()}/status.json`, JSON.stringify(this.lastStatus, null, 1));
    } catch (e) {
      log("tick error", e instanceof Error ? e.stack?.slice(0, 400) : e);
    } finally {
      this.busy = false;
    }
  }
}

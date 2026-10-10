/**
 * Desk engine v1 — the one process that trades. Loop (every 1 s, single-flight):
 *   G0 exchange open → G1 data fresh (index ≤5 s, book ≤3 s, bars ≤90 s, σ warm)
 *   → settlement P (martingale, 60-print average / Pyth close) → features (±4 pp max)
 *   → execution guard (fast-move cooldown, vol-scaled maker edge, final-seconds pull, 5¢ last-minute floor)
 *   → YES/NO executable edge sized to room → risk engine → OMS (1 order per tick, limit orders only)
 * A 250 ms guard loop reads the websocket prints and pulls resting bids the moment the index moves fast against them.
 * Every decision is written to the decision ledger; settled outcomes are joined for calibration.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  DAILY_STOP_USD,
  CALIBRATED_MODEL_APPROVED,
  MODEL_REV,
  MODEL_VERSION,
  REFERENCE,
  SERIES,
  SNAPSHOT_EVERY_MS,
  type Series,
  dataDir,
} from "./config";
import type { FeeInfo } from "./fees";
import { Feeds } from "./feeds";
import { type Book, type Side } from "./gate";
import { macroGate } from "./macro-calendar";
import { MoveGuard, against, pullReason } from "./guard";
import { exchangeStatus, fetchSnapshot, marketResult, openMarket, orderbook, eventFee, orderOutcomeSide, sidePrice, type KOrder, type Market, type Position } from "./kalshi-read";
import { DecisionLedger, type Decision } from "./ledger";
import { Oms } from "./oms";
import { RiskEngine, dayWorstOf, switches, type AccountSnapshot } from "./risk";
import { roomBudget } from "./sizing";

export type { SeriesEval } from "./evaluator";
import { Evaluator, decisionRowOf, type SeriesEval } from "./evaluator";

export type Resting = { orderId: string; ticker: string; series: string; side: Side; price: number; cid: string };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const seriesOf = (ticker: string) => ticker.split("-")[0];
/** V2 desk orders say "bid" (YES) / "ask" (NO); reading "ask" as YES mis-judged NO bids in the fast-move pull (review B2). */
const sideOf = (o: KOrder): Side | null => orderOutcomeSide(o);
/** A desk resting order as the guard sees it, or null if its side/price cannot be read (then it is pulled, never guessed). */
export function restingOf(o: KOrder): Resting | null {
  const side = sideOf(o);
  if (side == null) return null;
  let price: number;
  try {
    price = sidePrice(o);
  } catch {
    return null;
  }
  return { orderId: o.order_id, ticker: o.ticker, series: seriesOf(o.ticker), side, price, cid: o.client_order_id ?? "" };
}

export class Engine {
  feeds = new Feeds(true);
  risk = new RiskEngine();
  oms = new Oms(this.risk);
  ledger = new DecisionLedger();
  guard = new MoveGuard();
  evaluator = new Evaluator(this.feeds, this.guard);
  private markets = new Map<string, { m: Market | null; at: number }>();
  private fees = new Map<string, { info: FeeInfo; at: number }>();
  private ex = { tradingActive: false, at: 0 };
  private busy = false;
  private guardBusy = false;
  private tickId = 0;
  private lastOutcomeSweep = 0;
  private snapshot: AccountSnapshot | null = null;
  private snapAt = 0;
  private dirty = true;
  private resting: KOrder[] = [];
  private positions: Position[] = [];
  /** desk resting bids we know about (snapshot + our own fresh posts) — the guard loop cancels from this */
  private known = new Map<string, Resting>();
  errors = 0;
  lastStatus: Record<string, unknown> = {};

  async start() {
    mkdirSync(dataDir(), { recursive: true });
    await this.feeds.bootstrap();
    this.feeds.start();
    await this.oms.reconcilePending().catch(() => 0);
    log("engine started", MODEL_VERSION, MODEL_REV, "live", switches.live(), "begin", switches.begin(), "arm", switches.arm());
  }

  private async market(series: Series, now: number) {
    const c = this.markets.get(series);
    if (c && c.m && c.m.closeMs > now && now - c.at < 60_000) return c.m;
    if (c && !c.m && now - c.at < 5_000) return null;
    const m = await openMarket(series).catch(() => null);
    this.markets.set(series, { m, at: now });
    return m;
  }

  private async fee(market: Market | null, now: number): Promise<FeeInfo | null> {
    if (!market) return null;
    const c = this.fees.get(market.eventTicker);
    if (c && now - c.at < 60_000) return c.info;
    try {
      const info = await eventFee(market.series, market.eventTicker);
      this.fees.set(market.eventTicker, { info, at: now });
      return info;
    } catch {
      // Fee source unavailable: do not reuse an expired or cross-event cached fee.
      return null;
    }
  }

  evaluate(series: Series, m: Market | null, book: Book | null, fee: FeeInfo | null, now: number, exOk: boolean, budget: number): SeriesEval {
    return this.evaluator.evaluate(series, m, book, fee, now, exOk, budget);
  }

  private decisionRow(e: SeriesEval, action: Decision["action"], fee: FeeInfo | null, now: number, order?: Decision["order"]): Decision {
    return decisionRowOf(e, action, fee, now, order);
  }

  private async cancel(r: Resting, why: string, e?: SeriesEval) {
    if (!this.known.has(r.orderId) && !this.resting.some((o) => o.order_id === r.orderId)) return;
    this.known.delete(r.orderId);
    const st = await this.oms.cancel(r.orderId, r.ticker, r.cid, why).catch(() => 0);
    const now = Date.now();
    if (e) this.ledger.write(this.decisionRow({ ...e, failed: why }, "CANCEL", null, now, { cid: r.cid, orderId: r.orderId, status: `cancel http ${st}` }), now);
    log("CANCEL", r.ticker, r.side, r.price, why, st);
  }

  /** 250 ms loop on websocket prints: pull resting desk bids the instant the index moves fast against them. */
  async guardTick() {
    if (this.guardBusy || !this.known.size) return;
    this.guardBusy = true;
    try {
      const now = Date.now();
      for (const series of SERIES) {
        const mine = [...this.known.values()].filter((r) => r.series === series);
        if (!mine.length) continue;
        const ref = REFERENCE[series];
        const prints = this.feeds.prints(ref.index, now - 30_000);
        const g = this.guard.observe(series, prints, this.evaluator.sigmaBy.get(series) ?? null, now);
        if (!g.dir) continue;
        for (const r of mine) if (against(g.dir, r.side)) await this.cancel(r, `fast move ${g.dir} z=${g.z.toFixed(1)} (guard)`);
      }
    } catch (e) {
      this.errors += 1;
      log("guard error", e instanceof Error ? e.message.slice(0, 160) : e);
    } finally {
      this.guardBusy = false;
    }
  }

  /** Cancel desk resting bids per the guard rules (fast move, final seconds, 5¢ last minute, edge < hold) or outbid 90 s. */
  private async manageResting(evals: SeriesEval[], now: number) {
    for (const o of this.resting) {
      try {
        await this.manageOne(o, evals, now);
      } catch (err) {
        // one bad record must not stop the other resting orders from being checked this tick (review B5)
        this.errors += 1;
        log("manageResting error", o.order_id, err instanceof Error ? err.message.slice(0, 160) : err);
      }
    }
  }

  private async manageOne(o: KOrder, evals: SeriesEval[], now: number) {
    {
      if (!(o.client_order_id ?? "").startsWith("mm1-")) return; // never touch orders the desk didn't place
      const e = evals.find((x) => x.market?.ticker === o.ticker);
      const parsed = restingOf(o);
      if (!parsed) {
        await this.cancel({ orderId: o.order_id, ticker: o.ticker, series: seriesOf(o.ticker), side: "yes", price: Number.NaN, cid: o.client_order_id ?? "" }, "unreadable order side/price", e);
        return;
      }
      const r: Resting = parsed;
      let why: string | null = null;
      if (!e || !e.market) why = "market gone";
      else {
        why = pullReason({ side: r.side, price: r.price, p: e.p, failed: e.failed, shock: e.shock, tte: e.tte, lockFrac: e.lockFrac, kind: REFERENCE[e.series].kind, guard: e.guard });
        if (!why && e.book) {
          const myBid = r.side === "yes" ? e.book.yesBid : e.book.noBid;
          const age = now - Date.parse(o.created_time ?? new Date(now).toISOString());
          if (myBid && myBid.price > r.price + 0.015 && age > 90_000) why = "outbid >1¢ for 90s";
        }
      }
      if (why) await this.cancel(r, why, e);
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

  private async refreshSnapshot(now: number) {
    if (!this.dirty && this.snapshot && now - this.snapAt < SNAPSHOT_EVERY_MS) return;
    try {
      const r = await fetchSnapshot(this.ex, { pendingIntents: this.oms.pendingIntents(now), perTicker: this.oms.perTicker() });
      this.snapshot = this.risk.effective(r.snap, now);
      this.snapAt = now;
      this.dirty = false;
      this.resting = r.resting;
      this.positions = r.positions;
      this.known = new Map(
        r.resting
          .filter((o) => (o.client_order_id ?? "").startsWith("mm1-"))
          .map((o) => restingOf(o))
          .filter((x): x is Resting => x != null)
          .map((x) => [x.orderId, x]),
      );
      this.risk.observe(r.snap);
    } catch (e) {
      this.snapshot = null;
      this.errors += 1;
      log("snapshot error", e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }

  async tick() {
    if (this.busy) return; // single-flight tick lock
    this.busy = true;
    const tickId = ++this.tickId;
    const now = Date.now();
    try {
      if (tickId % 10 === 0) {
        this.feeds.flush();
        this.feeds.prune(now);
      }
      if (now - this.ex.at > 10_000) {
        const ex = await exchangeStatus().catch(() => null);
        this.ex = { tradingActive: Boolean(ex?.tradingActive), at: ex ? Date.now() : this.ex.at };
      }
      const exOk = this.ex.tradingActive && now - this.ex.at < 15_000;
      if (tickId % 5 === 0) await this.oms.reconcilePending(now).catch(() => 0);
      await this.refreshSnapshot(now);
      const budget = roomBudget(this.snapshot);
      const t0 = Date.now();
      const evals = await Promise.all(
        SERIES.map(async (s) => {
          const m = await this.market(s, t0);
          const [book, fee] = await Promise.all([m ? orderbook(m.ticker).catch(() => null) : Promise.resolve(null), this.fee(m, t0)]);
          return { e: this.evaluate(s, m, book, fee, Date.now(), exOk, budget), fee };
        }),
      );
      await this.manageResting(evals.map((x) => x.e), Date.now());

      // best candidate across series; skip tickers where the desk rests an order, just sent, or holds the other side
      const busyTickers = new Set([...this.known.values()].map((r) => r.ticker));
      for (const t of this.oms.recentTickers(Date.now())) busyTickers.add(t);
      const ranked = evals
        .filter((x) => x.e.best && x.e.market)
        .filter((x) => {
          const t = x.e.market!.ticker;
          if (busyTickers.has(t)) return false;
          const pos = this.positions.find((p) => p.ticker === t);
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
        // re-check the guard right before sending (the 250 ms loop may have tripped since evaluate)
        const g = this.guard.state(x.e.series, Date.now());
        if (g.cooling) {
          this.ledger.write(this.decisionRow({ ...x.e, failed: `G2_fast_move_cooldown_${g.dir}` }, "NO_TRADE", x.fee, now2), now2);
          continue;
        }
        const intent = { product: "event" as const, ticker: x.e.market!.ticker, side: b.side, mode: b.mode, price: b.price, count: b.count, fee: b.fee, tickId };
        const res = await this.oms.submit(intent, this.snapshot);
        if (res.cid) this.dirty = true; // anything that reached the OMS journal forces a fresh snapshot next tick
        if (res.ok) {
          sent += 1;
          if (b.mode === "maker" && res.orderId && res.status === "resting") {
            this.known.set(res.orderId, { orderId: res.orderId, ticker: intent.ticker, series: x.e.series, side: b.side, price: b.price, cid: res.cid ?? "" });
          }
        }
        this.ledger.write(
          this.decisionRow({ ...x.e, failed: res.ok ? null : res.why }, res.ok ? "BUY" : "REFUSED", x.fee, now2, { cid: res.cid, orderId: res.orderId, status: res.status, fill: res.fill, why: res.why }),
          now2,
        );
        log(res.ok ? "ORDER" : "REFUSED", intent.ticker, b.side, b.mode, b.price, "x", b.count, "edge", b.edge.toFixed(3), "need", (b.mode === "maker" ? x.e.makerMinEdge : 0.04).toFixed(3), res.why, res.status ?? "");
      }
      await this.sweepOutcomes(now2);
      const latched = this.risk.latched(now2);
      this.lastStatus = {
        ts: new Date(now2).toISOString(),
        model: `${MODEL_VERSION}+${MODEL_REV}`,
        tickId,
        errors: this.errors,
        omsJournalCorruptRows: this.oms.corruptRows,
        feeds: this.feeds.status,
        exchangeTradingActive: this.ex.tradingActive,
        switches: { live: switches.live(), begin: switches.begin(), arm: switches.arm() },
        latched: latched?.latchReason ?? null,
        budget,
        macro: macroGate(now2),
        strategyReadiness: {
          settlementModel: CALIBRATED_MODEL_APPROVED ? "reviewed" : "unapproved / shadow only",
          microstructure: "not integrated: distinct signed-trade and true venue-volume feeds required",
          higherTimeframes: "not integrated: persistent 15m and 1h spot/futures OHLCV required",
          externalContext: "not read by the engine; only the scheduled macro calendar can block entries",
        },
        snapshot: this.snapshot ? { dayWorst: dayWorstOf(this.snapshot), realized: this.snapshot.realizedToday, openWorst: this.snapshot.openWorst, restWorst: this.snapshot.restWorst, pendingWorst: this.snapshot.pendingWorst, shard2: this.snapshot.shard2Cash, ageMs: now2 - this.snapAt, override: this.snapshot.override ?? null, roomToStop: Number((dayWorstOf(this.snapshot) - DAILY_STOP_USD).toFixed(4)) } : null,
        resting: [...this.known.values()],
        sentThisTick: sent,
        series: evals.map(({ e }) => ({
          series: e.series,
          ticker: e.market?.ticker ?? null,
          tte: e.market ? Math.round((e.market.closeMs - now2) / 1000) : null,
          p: e.p,
          pBase: e.pBase,
          gate: e.failed ?? "PASS",
          best: e.best ? { side: e.best.side, mode: e.best.mode, price: e.best.price, count: e.best.count, edge: Number(e.best.edge.toFixed(4)) } : null,
          shock: Number(e.shock.toFixed(4)),
          makerMinEdge: Number(e.makerMinEdge.toFixed(4)),
          lockFrac: Number(e.lockFrac.toFixed(2)),
          moveZ: Number(e.guard.z.toFixed(2)),
          cooling: e.guard.cooling,
          makerOk: e.makerOk,
          sniper: e.sniper ? {
            long: { score: e.sniper.long.score, eligible: e.sniper.long.eligible, missing: e.sniper.long.missing },
            short: { score: e.sniper.short.score, eligible: e.sniper.short.eligible, missing: e.sniper.short.missing }
          } : null,
        })),
      };
      writeFileSync(`${dataDir()}/status.json`, JSON.stringify(this.lastStatus, null, 1));
    } catch (e) {
      this.errors += 1;
      log("tick error", e instanceof Error ? e.stack?.slice(0, 400) : e);
    } finally {
      this.busy = false;
    }
  }
}

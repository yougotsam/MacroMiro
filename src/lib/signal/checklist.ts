/**
 * The pre-trade checklist. Every ticket, perpetual or 15-minute, runs these steps in this order before any order:
 *   1 data fresh  2 structure  3 liquidity sweep  4 gap / order block  5 premium-discount  6 EMA stack + tunnel
 *   7 RSI + divergence  8 ADR exhaustion  9 VWAP side  10 killzone  11 release clock  12 news  13 MiroFish
 *   14 measured probability  15 measured verdict  16 edge after fees at the live price
 * Steps 2–13 explain the score; the score itself is the measured model (weights from the walk-forward fit),
 * so no step is a hand-tuned vote. Hard stops: 1, 15, 16. The order rule, risk and switches still apply after this.
 */
import { WARMUP, cacheOf, vectorAt, type Vector } from "./features";
import { contributions, predictVector } from "./model";
import { readNews, releaseProximity, minutesToNextRelease, type Asset, type NewsDocs, type NewsRead } from "./news";
import { sessionOf } from "./session";
import type { SignalModelFile } from "./store";
import type { Bar } from "./ta";

export type StepState = "pass" | "fail" | "long" | "short" | "neutral" | "info";
export type Step = { n: number; name: string; state: StepState; detail: string };

export type PreTrade = {
  asset: Asset;
  product: "prediction" | "perp";
  bias: "long" | "short" | "neutral";
  /** measured probability that the next 15 minutes close up; null when data or model is missing */
  pUp: number | null;
  /** probability for the chosen side */
  pSide: number | null;
  /** pSide − price − fee per contract; null without a live price */
  edge: number | null;
  steps: Step[];
  reasons: { feature: string; push: number }[];
  vector: Vector | null;
  news: NewsRead;
  fire: boolean;
  why: string;
};

const dirState = (x: number): StepState => (x > 0 ? "long" : x < 0 ? "short" : "neutral");

export function preTrade(input: {
  asset: Asset;
  product: "prediction" | "perp";
  bars: Bar[];
  now: number;
  releases: number[];
  docs: NewsDocs;
  file: SignalModelFile | null;
  /** live executable price for the chosen side (prediction: contract price 0–1); omit for a read-only brief */
  priceFor?: (side: "yes" | "no") => { price: number; feePer: number } | null;
}): PreTrade {
  const { asset, product, bars, now } = input;
  const news = readNews(asset, input.docs, now);
  const steps: Step[] = [];
  const add = (name: string, state: StepState, detail: string) => steps.push({ n: steps.length + 1, name, state, detail });
  const out = (p: Partial<PreTrade> & { why: string }): PreTrade => ({ asset, product, bias: "neutral", pUp: null, pSide: null, edge: null, steps, reasons: [], vector: null, news, fire: false, ...p });

  const last = bars[bars.length - 1];
  const ageMin = last ? (now - (last.t + 15 * 60_000)) / 60_000 : Infinity;
  const enough = bars.length >= WARMUP;
  const fresh = ageMin >= -1 && ageMin <= 20;
  add("Data fresh", enough && fresh ? "pass" : "fail", enough ? `last 15m bar closed ${ageMin.toFixed(1)} min ago` : `${bars.length}/${WARMUP} bars`);
  if (!enough || !fresh) return out({ why: "data not ready" });

  const s = cacheOf(bars);
  const i = bars.length - 1;
  const v = vectorAt(s, i, input.releases, news);
  if (!v) return out({ why: "indicators not ready" });
  add("Structure (BOS / ChoCH)", dirState(v.choch || v.bos), v.choch ? "change of character" : v.bos ? "break of structure" : "no fresh break");
  add("Liquidity sweep", dirState(v.sweep), v.sweep ? (v.sweep > 0 ? "swept the lows, closed back" : "swept the highs, closed back") : "none");
  add("Fair-value gap / order block", dirState(v.fvg || v.ob_retest), `gap ${v.fvg}, order block retest ${v.ob_retest}`);
  add("Premium / discount", "info", `${v.premium_discount > 0.4 ? "premium" : v.premium_discount < -0.4 ? "discount" : "middle"} of the 24h range (${v.premium_discount.toFixed(2)})`);
  add("EMA 9/21/50 + 13/50/200/800 tunnel", dirState(v.ema_stack + v.tunnel_stack), `stack ${v.ema_stack}, tunnel ${v.tunnel_stack}`);
  add("RSI + divergence", dirState(v.rsi_div), `RSI ${(50 + v.rsi * 50).toFixed(0)}, divergence ${v.rsi_div}`);
  add("ADR exhaustion", Math.abs(v.adr_exhaust) > 0.5 ? "info" : "pass", Math.abs(v.adr_exhaust) > 0.5 ? "day has used most of its average range" : "room left in the day");
  add("VWAP side", dirState(v.vwap), `${v.vwap >= 0 ? "above" : "below"} session VWAP`);
  add("Killzone", "info", sessionOf(now));
  const prox = releaseProximity(input.releases, now);
  const next = minutesToNextRelease(input.releases, now);
  add("Release clock", prox > 0 ? "info" : "pass", Number.isFinite(next) ? `next tier-1 release in ${Math.round(next)} min` : "none scheduled");
  add("News (Spark / rates)", news.sparkPresent || news.ratesPresent ? dirState(v.news_spark + v.news_rates) : "info", news.sparkPresent || news.ratesPresent ? `spark ${news.sparkBias.toFixed(2)}, rates ${news.ratesTilt.toFixed(2)}` : "no fresh card for this asset");
  add("MiroFish", news.mirofishP == null ? "info" : dirState(news.mirofishP - 0.5), news.mirofishP == null ? `${news.mirofishState}: not counted` : `swarm ${(news.mirofishP * 100).toFixed(0)}% up`);

  const file = input.file;
  if (!file) {
    add("Measured probability", "fail", "no measured model on disk (run bun scripts/signal-train.ts)");
    return out({ vector: v, why: "no model" });
  }
  const pUp = predictVector(file.model, v);
  const bias = pUp > 0.5 ? "long" : pUp < 0.5 ? "short" : "neutral";
  const pSide = bias === "short" ? 1 - pUp : pUp;
  const reasons = contributions(file.model, v).slice(0, 5);
  add("Measured probability", bias === "neutral" ? "neutral" : bias, `${(pUp * 100).toFixed(1)}% up · top: ${reasons.map((r) => r.feature).join(", ")}`);
  const verdict = file.verdict[product];
  add("Measured verdict (#124)", verdict.kept ? "pass" : "fail", verdict.kept ? `${verdict.trades} out-of-sample trades, ${(verdict.winRate * 100).toFixed(1)}% won, positive after fees` : verdict.why);
  const cut = file.entryCut[product];
  let edge: number | null = null;
  if (bias !== "neutral" && input.priceFor) {
    const side = bias === "long" ? "yes" : "no";
    const q = input.priceFor(side);
    if (q) edge = product === "prediction" ? pSide - q.price - q.feePer : Math.abs(pUp - 0.5) - q.feePer;
  }
  add("Edge after fees", edge == null ? "fail" : edge >= cut ? "pass" : "fail", edge == null ? "no live price" : `${(edge * 100).toFixed(2)}¢ vs needed ${(cut * 100).toFixed(1)}¢`);
  const fire = verdict.kept && edge != null && edge >= cut && bias !== "neutral";
  return out({ bias, pUp, pSide, edge, reasons, vector: v, fire, why: fire ? "all hard steps pass" : !verdict.kept ? "not kept by the measured test" : edge == null ? "no live price" : bias === "neutral" ? "no side" : "edge below the measured cut" });
}

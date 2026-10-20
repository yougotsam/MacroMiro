/**
 * Resolution rider. Research only. Nothing in the live sender imports this file.
 * The last-minute, last-45-second, and price-band rules are the same constants the desk already uses.
 */
import {
  BASE_MIN_EDGE,
  FINAL_PULL_SEC,
  LAST_MINUTE_MIN_PRICE,
  LAST_MINUTE_SEC,
  LOCK_MIN_FRAC,
  MAKER_MIN_EDGE,
  MIN_SECONDS_LEFT,
  PRICE_MAX,
  PRICE_MIN,
  TAKER_MIN_EDGE,
} from "../desk/config";

export const RIDER_SETUP = "resolution-rider";
export const RIDER_WINDOW_SEC = 90;

export type RiderInput = {
  tteSec: number;
  favored: "yes" | "no" | null;
  favoredPrice: number;
  spread: number;
  tick: number;
  /** Close of the last closed 1-minute bar minus the close before it. Null if that bar is not closed. */
  momentum: number | null;
  sigma1m: number | null;
  /** Signed order-flow imbalance. Positive means buyers lifted the offer. Null means the feed is missing. */
  ofi: number | null;
  /** Share of the 60-second settlement average already printed. Used only inside the last 45 seconds. */
  lockFrac: number | null;
  makerEdge: number;
  takerEdge: number;
};

export type RiderDecision = {
  setup: typeof RIDER_SETUP;
  trade: boolean;
  mode: "maker" | "taker" | "none";
  reasons: Record<string, string>;
};

export function resolutionRider(i: RiderInput): RiderDecision {
  const reasons: Record<string, string> = {};
  const fail = (key: string, why: string): RiderDecision => {
    reasons[key] = why;
    return { setup: RIDER_SETUP, trade: false, mode: "none", reasons };
  };

  if (i.tteSec > RIDER_WINDOW_SEC) return fail("window", `too early ${i.tteSec}s`);
  reasons.window = "inside 90s";
  if (i.tteSec < MIN_SECONDS_LEFT) return fail("window", `inside the last ${MIN_SECONDS_LEFT}s`);

  if (i.favored !== "yes" && i.favored !== "no") return fail("favorite", "no favored side");
  if (i.favoredPrice > PRICE_MAX) return fail("band", `price ${i.favoredPrice} above ${PRICE_MAX}`);
  if (i.favoredPrice < PRICE_MIN) return fail("band", `price ${i.favoredPrice} below ${PRICE_MIN}`);
  if (i.favoredPrice < 0.55) return fail("favorite", `price ${i.favoredPrice} is not a strong favorite`);
  reasons.favorite = i.favored;
  reasons.band = "inside the existing band";

  if (i.tteSec <= LAST_MINUTE_SEC && i.favoredPrice < LAST_MINUTE_MIN_PRICE) return fail("last_minute", "under the last-minute floor");
  reasons.last_minute = "ok";

  if (i.tteSec <= FINAL_PULL_SEC) {
    if (i.lockFrac == null || i.lockFrac < LOCK_MIN_FRAC) return fail("pull", `lock ${i.lockFrac ?? "missing"} < ${LOCK_MIN_FRAC}`);
    reasons.pull = "lock fraction holds the last 45s";
  } else reasons.pull = "outside the pull window";

  if (i.momentum == null || !Number.isFinite(i.momentum) || i.momentum === 0) return fail("momentum", "no closed 1m confirmation");
  const momOk = i.favored === "yes" ? i.momentum > 0 : i.momentum < 0;
  if (!momOk) return fail("momentum", "1m momentum opposes the favorite");
  reasons.momentum = "confirms";

  if (!(i.tick > 0) || i.spread > 2 * i.tick + 1e-9) return fail("spread", `spread ${i.spread} wider than 2 ticks`);
  reasons.spread = "tight";

  if (i.ofi == null) {
    const sigma = i.sigma1m;
    if (sigma == null || !(sigma > 0) || Math.abs(i.momentum) < 2 * sigma) return fail("ofi", "flow missing and the 1m move is under 2 sigma");
    reasons.ofi = "missing; 2 sigma momentum stands in";
  } else {
    const flowOk = i.favored === "yes" ? i.ofi > 0 : i.ofi < 0;
    if (!flowOk) return fail("ofi", "order flow opposes the favorite");
    reasons.ofi = "confirms";
  }

  if (i.makerEdge >= MAKER_MIN_EDGE && i.makerEdge >= BASE_MIN_EDGE) {
    reasons.execution = "maker";
    return { setup: RIDER_SETUP, trade: true, mode: "maker", reasons };
  }
  if (i.takerEdge >= TAKER_MIN_EDGE) {
    reasons.execution = "taker";
    return { setup: RIDER_SETUP, trade: true, mode: "taker", reasons };
  }
  return fail("execution", "edge under the existing maker and taker floors");
}

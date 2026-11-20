/** Research-only contract settlement estimate, not a next-bar candle forecast.
 * Kalshi YES settles by the market's defined index and strike. An estimate
 * cannot authorize an order without a separate calibrated approval.
 */
import { INDEX_MAX_AGE_MS, MIN_VOL_SAMPLES } from "./config";
import { clampP, cryptoProb, goldProb, sigmaFromPrints, SIGMA_FLOOR } from "./settlement";
import type { Feeds } from "./feeds";
import type { Market } from "./kalshi-read";
import type { Series } from "./config";
import { REFERENCE } from "./config";

export type ContractQuote =
  | { ok: true; pYes: number; sigma: number; evidence: string }
  | { ok: false; why: string };

type IndexReads = Pick<Feeds, "last" | "prints" | "windowMap" | "lastOfficialAverage">;

/** Never substitute P(next candle up) for P(actual contract settles YES). */
export function estimateContractSettlement(
  feeds: IndexReads, series: Series, market: Pick<Market, "strike" | "closeMs">, now: number,
): ContractQuote {
  const ref = REFERENCE[series];
  const last = feeds.last(ref.index);
  if (!last || !Number.isFinite(now) || last.t > now + 500 ||
      now - last.t > INDEX_MAX_AGE_MS || now - last.recv > INDEX_MAX_AGE_MS)
    return { ok: false, why: "index_missing_or_stale" };
  if (!(market.strike > 0) || !(market.closeMs > now))
    return { ok: false, why: "contract_strike_or_close_invalid" };

  const floor = SIGMA_FLOOR[ref.index];
  if (!Number.isFinite(floor) || !(floor > 0))
    return { ok: false, why: "unsupported_settlement_index" };
  const prints = feeds.prints(ref.index, now - 60 * 60_000);
  const vol = sigmaFromPrints(prints, now, floor);
  if (vol.sigma == null || vol.n < MIN_VOL_SAMPLES)
    return { ok: false, why: "insufficient_index_volatility_history" };
  try {
    const estimate = ref.kind === "rti60"
      ? (() => {
          const a = feeds.lastOfficialAverage(ref.index);
          const official = a && a.t === last.t
            ? { value: a.value, count: a.windowSize, t: a.t }
            : undefined;
          return cryptoProb({
            closeMs: market.closeMs, strike: market.strike, dp: ref.dp,
            last, windowPrints: feeds.windowMap(ref.index, market.closeMs - 59_000, market.closeMs + 1_000),
            official, sigma: vol.sigma!,
          });
        })()
      : goldProb({ closeMs: market.closeMs, strike: market.strike, dp: ref.dp, last, sigma: vol.sigma });
    if (!Number.isFinite(estimate.p) || estimate.p < 0 || estimate.p > 1)
      return { ok: false, why: "settlement_probability_invalid" };
    return { ok: true, pYes: clampP(estimate.p), sigma: vol.sigma, evidence: estimate.why };
  } catch {
    // A gap in the final-minute 60-print sequence is unknown, never a YES edge.
    return { ok: false, why: "settlement_index_window_incomplete_or_invalid" };
  }
}

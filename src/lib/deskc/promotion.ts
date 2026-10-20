/**
 * A setup becomes ELIGIBLE only from the scorecard. There is no manual promote switch.
 * This file does not send an order.
 */
import { MODEL_VERSION } from "../desk/config";
import { brier, brierBeatsPrice, netEv, walkWindows, type DecisionRow } from "./scorecard";

export const MIN_DECISIONS = 300;

export type SetupStatus = "RESEARCH" | "ELIGIBLE";

export type SetupVerdict = {
  state: SetupStatus;
  why: string;
  n: number;
  brier: number;
  priceBrier: number;
  ev: number;
  fresh: boolean;
  beatsPrice: boolean;
  fills: number;
  fillsPnl: number;
};

export type PromotionDoc = {
  modelVersion: string;
  at: number;
  setups: Record<string, SetupVerdict>;
};

export function judgeSetup(rows: DecisionRow[], opts: { windowSize?: number; embargoMs?: number } = {}): SetupVerdict {
  const size = opts.windowSize ?? 100;
  const embargoMs = opts.embargoMs ?? 15 * 60_000;
  const scored = rows.filter((r) => r.settledYes != null);
  const pairs = scored.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
  const cmp = brierBeatsPrice(pairs);
  const modelBrier = pairs.length ? pairs.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / pairs.length : Number.NaN;
  const priceBrier = pairs.length ? pairs.reduce((a, r) => a + (r.price - r.y) ** 2, 0) / pairs.length : Number.NaN;
  const ev = netEv(scored);
  const fresh = scored.length > 0 && scored.every((r) => r.fresh);
  const fills = scored.filter((r) => r.filled);
  const fillsPnl = fills.reduce((a, r) => a + (r.pnlAfterFees ?? 0), 0);
  const windows = walkWindows(scored, size, embargoMs).filter((w) => w.length >= Math.min(size, 20));
  const bad = (w: DecisionRow[]) => {
    const ps = w.map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
    const mb = brier(ps);
    const pb = brier(ps.map((r) => ({ p: r.price, y: r.y })));
    return mb >= pb || netEv(w) < 0;
  };
  const lastTwo = windows.slice(-2);
  const demoted = lastTwo.length === 2 && lastTwo.every(bad);
  const base: SetupVerdict = {
    state: "RESEARCH",
    why: "short",
    n: scored.length,
    brier: modelBrier,
    priceBrier,
    ev,
    fresh,
    beatsPrice: cmp.better,
    fills: fills.length,
    fillsPnl,
  };
  if (scored.length < MIN_DECISIONS) return { ...base, why: `n ${scored.length} < ${MIN_DECISIONS}` };
  if (!fresh) return { ...base, why: "stale row in the window" };
  if (!cmp.better) return { ...base, why: "model Brier does not beat the price at 95%" };
  if (!(ev > 0)) return { ...base, why: "after-fee EV is not positive" };
  if (demoted) return { ...base, why: "two consecutive walk-forward windows lost to the price or lost money" };
  return { ...base, state: "ELIGIBLE", why: "passed" };
}

export function promotionDocument(bySetup: Record<string, DecisionRow[]>, at: number, modelVersion = MODEL_VERSION, opts?: { windowSize?: number; embargoMs?: number }): PromotionDoc {
  const setups: Record<string, SetupVerdict> = {};
  for (const [id, rows] of Object.entries(bySetup)) setups[id] = judgeSetup(rows, opts);
  return { modelVersion, at, setups };
}

/** Percent-of-account sizing stays refused until one eligible setup also has a positive fill record. */
export function pctModeInterlock(doc: PromotionDoc | null): { ok: boolean; why: string } {
  if (!doc || doc.modelVersion !== MODEL_VERSION) return { ok: false, why: "promotion file missing or model version mismatch" };
  const hit = Object.values(doc.setups).find((s) => s.state === "ELIGIBLE" && s.n >= MIN_DECISIONS && s.fills > 0 && s.fillsPnl > 0);
  if (!hit) return { ok: false, why: "no eligible setup with 300 decisions and a positive fill record" };
  return { ok: true, why: "evidence is present; LIMITED_LIVE still needs a separate owner approval" };
}

/**
 * Research setups keep the flat dollar budget they already had.
 * Full Kelly runs only after the scorecard marks that setup ELIGIBLE, and it cannot exceed the flat budget.
 * This does not raise a cap and it does not send an order.
 */
import type { PromotionDoc } from "../deskc/promotion";
import { fullKellyStake } from "../deskc/sizing";
import { orderFee, type FeeInfo } from "./fees";
import { sizeFor } from "./gate";

export function setupName(side: "yes" | "no", confluence: { long?: { setup?: string }; short?: { setup?: string } } | null | undefined): string {
  const named = side === "yes" ? confluence?.long?.setup : confluence?.short?.setup;
  return named && named !== "NONE" ? named : "settlement-model";
}

export function promotionSize(i: {
  doc: PromotionDoc | null;
  setup: string;
  flatCount: number;
  flatFee: number;
  price: number;
  maker: boolean;
  fee: FeeInfo;
  pSide: number;
  flatBudget: number;
  bankroll: number;
}): { count: number; fee: number; why: string } {
  const verdict = i.doc?.setups[i.setup];
  if (!verdict || verdict.state !== "ELIGIBLE") {
    return { count: i.flatCount, fee: i.flatFee, why: "research flat budget" };
  }
  const kelly = fullKellyStake({
    setup: i.setup,
    doc: i.doc,
    calibrated: true,
    p: i.pSide,
    price: i.price,
    bankroll: i.bankroll,
    flatBudget: i.flatBudget,
    roomTotal: i.flatBudget,
    roomTicker: i.flatBudget,
    roomCorrelated: i.flatBudget,
  });
  if (!(kelly.stake > 0)) return { count: 0, fee: 0, why: kelly.why };
  const count = sizeFor(i.price, i.maker, i.fee, kelly.stake);
  if (count < 1) return { count: 0, fee: 0, why: "kelly below one contract" };
  return { count, fee: orderFee(count, i.price, i.maker, i.fee), why: kelly.why };
}

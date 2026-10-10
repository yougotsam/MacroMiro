/**
 * Paper P&L in real USD for a Kalshi binary contract bought as a taker and held to settlement.
 * Cost = qty × executable ask; Kalshi quadratic fee (fees.ts, the same function the desk uses);
 * payout = $1 per contract if the bought side wins, else $0. Net = payout − cost − fee.
 */
import { quadraticFee } from "@/lib/desk/fees";

export type Side = "yes" | "no";
export type PaperFill = { side: Side; price: number; qty: number; feeMultiplier: number };

export function entryCost(f: PaperFill) {
  const fee = quadraticFee(f.qty, f.price, f.feeMultiplier);
  return { cost: +(f.qty * f.price).toFixed(4), fee, total: +(f.qty * f.price + fee).toFixed(4) };
}

export function settle(f: PaperFill, result: "yes" | "no") {
  const { cost, fee } = entryCost(f);
  const won = result === f.side;
  const payout = won ? f.qty : 0;
  return { won, payout, cost, fee, net: +(payout - cost - fee).toFixed(4) };
}

/** Largest whole-contract quantity within the per-ticker USD cap and the displayed size at that price. */
export function sizeFor(price: number, available: number, capUsd: number, feeMultiplier = 1) {
  if (!(price > 0 && price < 1) || !(available >= 1)) return 0;
  let q = Math.min(Math.floor(available), Math.floor(capUsd / price));
  while (q > 0 && q * price + quadraticFee(q, price, feeMultiplier) > capUsd + 1e-9) q -= 1;
  return q;
}

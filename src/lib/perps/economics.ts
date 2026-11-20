/**
 * One direction-signed, fill-based P&L calculator for Kalshi margin trades.
 * Fill prices already include bid/ask spread and slippage: never charge twice.
 * Microdollar accounting avoids floating-point drift across fees and scale-outs.
 */
export type Decimal = number | string;
export type PerpFill = { price: Decimal; qty: Decimal; feeUsd: Decimal };
export type PerpPnlInput = {
  direction: "long" | "short";
  entryFills: readonly PerpFill[];
  exitFills: readonly PerpFill[];
  /** Positive funding is a credit; negative funding is a charge. */
  fundingPaymentsUsd?: readonly Decimal[];
};
const MICRO = 1_000_000n;
function micro(v: Decimal): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v));
  if (!match) throw new Error("invalid decimal amount");
  const fraction = match[3] ?? "";
  const amount = BigInt(match[2]) * MICRO +
    BigInt(fraction.slice(0, 6).padEnd(6, "0") || "0") +
    (fraction.length > 6 && Number(fraction[6]) >= 5 ? 1n : 0n);
  return match[1] === "-" ? -amount : amount;
}
function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("invalid denominator");
  const sign = n < 0n ? -1n : 1n, abs = n < 0n ? -n : n;
  return sign * ((abs + d / 2n) / d);
}
function notionalMicro(fill: PerpFill): bigint {
  const price = micro(fill.price), qty = micro(fill.qty);
  if (price <= 0n || qty <= 0n) throw new Error("price and quantity must be positive");
  return divRound(price * qty, MICRO);
}
const usd = (n: bigint) => Number(n) / Number(MICRO);
/** Refuses to treat an incompletely closed position as realized P&L. */
export function calculatePerpPnl(input: PerpPnlInput) {
  if (!input.entryFills.length || !input.exitFills.length) throw new Error("entry and exit fills required");
  const totalQty = (rows: readonly PerpFill[]) => rows.reduce((a, f) => a + micro(f.qty), 0n);
  const qty = totalQty(input.entryFills);
  if (qty !== totalQty(input.exitFills) || qty <= 0n) throw new Error("position not fully closed");
  const entry = input.entryFills.reduce((a, f) => a + notionalMicro(f), 0n);
  const exit = input.exitFills.reduce((a, f) => a + notionalMicro(f), 0n);
  const fees = [...input.entryFills, ...input.exitFills].reduce((a, f) => a + micro(f.feeUsd), 0n);
  const funding = (input.fundingPaymentsUsd ?? []).reduce((a, f) => a + micro(f), 0n);
  const gross = input.direction === "long" ? exit - entry : entry - exit;
  return { grossUsd: usd(gross), feesUsd: usd(fees), fundingUsd: usd(funding),
    netUsd: usd(gross - fees + funding), quantity: usd(qty) };
}
export function feeForFill(price: Decimal, qty: Decimal, rate: Decimal): number {
  return usd(divRound(notionalMicro({ price, qty, feeUsd: 0 }) * micro(rate), MICRO));
}
export function estimatePerpPnl(input: {
  direction: "long" | "short";
  entries: readonly { price: Decimal; qty: Decimal; rate: Decimal }[];
  exits: readonly { price: Decimal; qty: Decimal; rate: Decimal }[];
  fundingUsd?: readonly Decimal[];
}) {
  return calculatePerpPnl({
    direction: input.direction,
    entryFills: input.entries.map(f => ({ price: f.price, qty: f.qty, feeUsd: feeForFill(f.price, f.qty, f.rate) })),
    exitFills: input.exits.map(f => ({ price: f.price, qty: f.qty, feeUsd: feeForFill(f.price, f.qty, f.rate) })),
    fundingPaymentsUsd: input.fundingUsd,
  });
}

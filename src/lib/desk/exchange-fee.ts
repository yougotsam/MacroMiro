/** Kalshi's own fee fields. Missing fields stay unknown. Never invent a taker fee. */
export function exchangeFee(src: { taker_fees_dollars?: string; maker_fees_dollars?: string } | null | undefined): { fee: number | null; feeSource: "exchange" | "unknown" } {
  if (!src) return { fee: null, feeSource: "unknown" };
  const hasTaker = src.taker_fees_dollars != null && src.taker_fees_dollars !== "";
  const hasMaker = src.maker_fees_dollars != null && src.maker_fees_dollars !== "";
  if (!hasTaker && !hasMaker) return { fee: null, feeSource: "unknown" };
  const taker = hasTaker ? Number(src.taker_fees_dollars) : 0;
  const maker = hasMaker ? Number(src.maker_fees_dollars) : 0;
  if (!Number.isFinite(taker) || !Number.isFinite(maker) || taker < 0 || maker < 0) return { fee: null, feeSource: "unknown" };
  return { fee: Number((taker + maker).toFixed(6)), feeSource: "exchange" };
}

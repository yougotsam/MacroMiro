/**
 * Correlated-exposure grouping (written down per the live-trading safety checklist, control 5).
 * The four crypto 15-minute series settle on CF Benchmarks RTIs that move together, most of all in bad markets,
 * so every same-direction crypto contract (any coin, any open window) is ONE bet: "crypto|up" / "crypto|down".
 * Gold settles on a Pyth metal index with a different driver and is its own group: "gold|up" / "gold|down".
 * Buying YES = "up", buying NO = "down".
 */
export function correlationGroup(ticker: string): "crypto" | "gold" | null {
  if (/^KX(?:BTC|ETH|SOL|XRP)15M-/.test(ticker)) return "crypto";
  if (/^KXGOLD15M-/.test(ticker)) return "gold";
  return null;
}

export function correlationKey(ticker: string, dir: "up" | "down") {
  return `${correlationGroup(ticker) ?? `other:${ticker}`}|${dir}`;
}

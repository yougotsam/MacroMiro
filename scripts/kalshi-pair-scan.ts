/** Read-only Kalshi 15m YES+NO pair-cost scan (public GETs only).  bun scripts/kalshi-pair-scan.ts */
import { SERIES } from "../src/lib/desk/config";
import { openMarket, orderbook } from "../src/lib/desk/kalshi-read";
import { pairCost, takerFee } from "../src/lib/desk/pair-scan";
for (const s of SERIES) {
  const m = await openMarket(s); if (!m) { console.log(s, "no open market"); continue; }
  const b = await orderbook(m.ticker);
  console.log(JSON.stringify({ series: s, at: new Date(b.ts).toISOString(), ...pairCost({ ticker: m.ticker, yesBid: b.yesBid?.price ?? null, noBid: b.noBid?.price ?? null }, (p) => takerFee(p)) }));
}

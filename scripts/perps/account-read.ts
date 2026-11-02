/**
 * Read-only live account audit: authenticated margin balance, positions, recent
 * fills. NEVER writes to Kalshi, changes trading modes, or prints credentials.
 *   bun scripts/perps/account-read.ts
 *
 * Run on the owner's already provisioned machine, not a public web endpoint.
 */
import { perpsReader } from "../../src/lib/perps/kalshi-perps-read";
import { liveMarginTransport } from "../../src/lib/perps/live-transport";
import { parseMarginAccount, summarizeFillPnl } from "../../src/lib/perps/account-state";

const now = Date.now();
const start = now - 24 * 60 * 60_000;
const [balanceRaw, positions, fills] = await Promise.all([
  perpsReader().balance(),
  liveMarginTransport.positions(),
  liveMarginTransport.fills({ min_ts: Math.floor(start / 1000) }),
]);
const account = parseMarginAccount(balanceRaw, 0);
const pnl = summarizeFillPnl(fills, start, now);
const out = {
  at: new Date(now).toISOString(),
  lane: "kalshi-margin-perpetuals",
  orderWrites: false,
  depositActions: false,
  balance: account,
  positions: positions.map((p) => ({ ticker: p.market_ticker, qty: p.position, entry: p.entry_price, unrealized: p.unrealized_pnl, fees: p.fees })),
  last24hFillDiagnostic: pnl,
  completeness: "NOT CERTIFIED: limited API pagination, opening exposures, funding and venue equity history require full reconciliation. This audit NEVER unlocks trading.",
};
console.log(JSON.stringify(out, null, 2));

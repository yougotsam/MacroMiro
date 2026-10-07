---
name: kalshi-perps
description: >
  Kalshi margin perpetuals. Same company as the 15-minute tickets, different
  cash pile, different order path. Do not pay for a ticket from this account.
---

# Kalshi perpetuals

The written rule is the Perps section of `docs/STRATEGY.md`. The decision is `src/lib/scan/perp-desk.ts`. The order is `src/lib/scan/kalshi-perp-order.ts`.

Host: `https://external-api.kalshi.com/trade-api/v2`. Orders: `POST /margin/orders`. Long is bid. Short is ask. Price is dollars, not cents.

Names: KXGOLDPERP, KXBTCPERP, KXETHPERP, KXSOLPERP, KXXRPPERP, KXBNBPERP, KXSILVERPERP, KXUS500PERP.

Need three finished minutes the same way, and the push at least twice the recent noise. The bear in `src/lib/agent/tauric-debate.ts` does not sit a wide spread. Collateral is $25 to $35, and only if the margin account has at least $25. Do not move 15-minute cash into this account. Stop is about 10% of the margin. First target is about 20%.

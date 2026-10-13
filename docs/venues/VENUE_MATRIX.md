# Venue matrix (verified 2026-10-12 15:4x PT, read-only)

## Kalshi perps (margin), production
- `/margin/enabled` = **true** (signed GET). `/margin/exchange/status` = exchange_active true, trading_active true. Balance `/margin/balance` = **$0.00** (subaccount 0).
- **Funding the account** (help.kalshi.com article 15357664): (1) direct ACH/wire deposit to the margin account, or (2) transfer from the predictions balance in the website **Portfolio** tab. Only the **API** transfer endpoint is not live yet. Status: **available per Kalshi Help; NEEDS_OWNER_UI_CHECK** (logged-in Portfolio tab) to confirm it is offered on this account. Nothing was moved.
- Funding rate is paid every 8 h (04:00/12:00/20:00 UTC). Positive means longs pay shorts. Endpoint `/margin/funding_rates/estimate?ticker=` (the earlier 404 used the wrong path `/estimated`) and `/margin/funding_rates/historical`.
- Price bands: ticks of $0.0001. Bids ≥ min(80% of best bid, best bid − 1000 ticks); asks ≤ max(120% of best ask, best ask + 1000 ticks). Amends outside the band are refused.
- Fee tier 0 (account): crypto maker 0.02% / taker 0.12%; metals and US500 0.0012% / 0.0072%; WTI 0.004% / 0.024%. Tiers 1–5 go down to maker 0% / taker 0.01%.
- Initial-margin multiplier 1.3 on all markets. Maintenance Thursdays 3–5 AM ET (no new orders; funding processed afterwards).
- Native stop-loss, take-profit and trailing triggers, plus post_only and reduce_only (API docs "exit-triggers"; Pro help). Not tested yet.
- Venue 1m candles for SILVER, DOGE and US500 contained many impossible bars (dropped by `cleanBars`). Build our own bars from trades in 2B.

| Ticker | Class | Status | Bid / ask | Spread | Contract size | Tick | Leverage est. | Maker / taker | Funding est. (per 8h) | Open interest | 24h volume (notional) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| KXAAVEPERP | Crypto | active | 1.5871 / 1.589 | 0.120% | 0.01 | 0.0001 | 3.4× | 0.0200% / 0.1200% | 0.0000% | $167,008 | $357,001 |
| KXADAPERP | Crypto | active | 0.2377 / 0.238 | 0.126% | 1 | 0.0001 | 3.2× | 0.0200% / 0.1200% | 0.0000% | $323,064 | $672,732 |
| KXALUMINUMPERP | Metals | active | 3.0453 / 3.0479 | 0.085% | 0.001 | 0.0001 | 8.1× | 0.0012% / 0.0072% | 0.0000% | $33,664 | $1,169,834 |
| KXBCHPERP | Crypto | active | 2.7048 / 2.7088 | 0.148% | 0.01 | 0.0001 | 2.3× | 0.0200% / 0.1200% | 0.0000% | $289,651 | $927,702 |
| KXBNBPERP | Crypto | active | 0.7413 / 0.7418 | 0.067% | 0.001 | 0.0001 | 4.8× | 0.0200% / 0.1200% | 0.0117% | $364,398 | $426,935 |
| KXBTCPERP | Crypto | active | 8.2487 / 8.2489 | 0.002% | 0.0001 | 0.0001 | 6.4× | 0.0200% / 0.1200% | 0.0192% | $15,978,165 | $359,778,644 |
| KXCOPPERPERP | Metals | active | 6.8397 / 6.8406 | 0.013% | 1 | 0.0001 | 7.9× | 0.0012% / 0.0072% | 0.0000% | $179,973 | $456,914 |
| KXDOGEPERP | Crypto | active | 8.3765 / 8.3833 | 0.081% | 100 | 0.0001 | 2.8× | 0.0200% / 0.1200% | 0.0215% | $745,418 | $1,176,187 |
| KXETHPERP | Crypto | active | 2.4839 / 2.4841 | 0.008% | 0.001 | 0.0001 | 4.9× | 0.0200% / 0.1200% | 0.0000% | $10,920,665 | $391,250,386 |
| KXGOLDPERP | Metals | active | 4.1729 / 4.173 | 0.002% | 0.001 | 0.0001 | 15.3× | 0.0012% / 0.0072% | 0.0293% | $6,046,335 | $27,964,956 |
| KXHYPEPERP | Crypto | active | 8.272 / 8.2777 | 0.069% | 0.1 | 0.0001 | 2.3× | 0.0200% / 0.1200% | 0.0331% | $1,845,525 | $2,834,067 |
| KXKPEPEPERP | Crypto | inactive | 0 / 0 | – | 1000 | 0.0001 | 1.7× | 0.0200% / 0.1200% | NaN% | $0 | $0 |
| KXKSHIBPERP | Crypto | active | 5.2288 / 5.2336 | 0.092% | 1000 | 0.0001 | 2.2× | 0.0200% / 0.1200% | -0.0127% | $58,353 | $617,701 |
| KXLINKPERP | Crypto | active | 12.86 / 12.8737 | 0.106% | 1 | 0.0001 | 3.7× | 0.0200% / 0.1200% | 0.0448% | $622,705 | $315,115 |
| KXLTCPERP | Crypto | active | 6.1683 / 6.1721 | 0.062% | 0.1 | 0.0001 | 4.0× | 0.0200% / 0.1200% | 0.0000% | $224,007 | $626,924 |
| KXNEARPERP | Crypto | active | 5.1144 / 5.121 | 0.129% | 1 | 0.0001 | 2.0× | 0.0200% / 0.1200% | 0.0000% | $745,619 | $7,644,432 |
| KXPALLADIUMPERP | Metals | active | 1.1464 / 1.1472 | 0.070% | 0.001 | 0.0001 | 4.6× | 0.0012% / 0.0072% | 0.0000% | $103,325 | $2,086,453 |
| KXPLATINUMPERP | Metals | active | 1.6951 / 1.6954 | 0.018% | 0.001 | 0.0001 | 6.6× | 0.0012% / 0.0072% | 0.0349% | $473,626 | $1,488,506 |
| KXSILVERPERP | Metals | active | 6.033 / 6.0337 | 0.012% | 0.1 | 0.0001 | 8.3× | 0.0012% / 0.0072% | 0.0421% | $2,822,038 | $13,233,033 |
| KXSOLPERP | Crypto | active | 10.6734 / 10.6774 | 0.037% | 0.1 | 0.0001 | 3.1× | 0.0200% / 0.1200% | 0.0307% | $3,511,251 | $16,823,652 |
| KXSUIPERP | Crypto | active | 10.4881 / 10.4995 | 0.109% | 10 | 0.0001 | 2.5× | 0.0200% / 0.1200% | 0.0347% | $392,219 | $511,161 |
| KXUNIPERP | Crypto | active | 7.1918 / 7.2006 | 0.122% | 1 | 0.0001 | 2.8× | 0.0200% / 0.1200% | 0.0681% | $92,818 | $1,438,137 |
| KXUS500PERP | Indices | active | 13.7518 / 13.753 | 0.009% | 0.001 | 0.0001 | 13.7× | 0.0012% / 0.0072% | 0.0000% | $1,455,779 | $5,246,094 |
| KXUSTECH100PERP | Indices | inactive | 0 / 0 | – | 0.0001 | 0.0001 | 11.3× | 0.0012% / 0.0072% | NaN% | $0 | $0 |
| KXVVVPERP | Crypto | active | 2.2786 / 2.282 | 0.149% | 0.1 | 0.0001 | 1.8× | 0.0200% / 0.1200% | 0.0000% | $48,107 | $1,837,758 |
| KXWLDPERP | Crypto | active | 0.5056 / 0.5065 | 0.178% | 1 | 0.0001 | 1.7× | 0.0200% / 0.1200% | 0.0000% | $226,888 | $1,572,949 |
| KXWTIFUTURE | Energy | inactive | 0 / 0 | – | 0.01 | 0.0001 | 6.0× | 0.0040% / 0.0240% | NaN% | $0 | $0 |
| KXXRPPERP | Crypto | active | 1.3527 / 1.3532 | 0.037% | 1 | 0.0001 | 2.9× | 0.0200% / 0.1200% | 0.0197% | $2,134,641 | $4,701,932 |
| KXZECPERP | Crypto | active | 12.0333 / 12.0495 | 0.135% | 0.01 | 0.0001 | 2.3× | 0.0200% / 0.1200% | 0.0783% | $1,773,653 | $3,346,495 |


## Kalshi 15m YES/NO
Existing engine. Approved limits in RISK_MANDATES. Shard-2 status must be explicit.

## Coinbase (connected MCP, read-only verified 2026-10-12)
Intro tier maker 0.50% / taker 0.90%. Default portfolio holds dust only (~$0). Spot is long-only. US dated futures (CFM) are listed and need separate futures approval. No perps in this account view.

## Future venues
Hyperliquid (perps, on-chain P&L, research and later adapter), Polymarket (research only: wallet P&L is verifiable on-chain), Whatnot (commerce, separate keys). None are connected.

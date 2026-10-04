# Desk rule

Two engines. They do not share cash.

The 15-minute ticket function is `src/lib/scan/edge.ts`. The perpetual function is `src/lib/scan/perp-desk.ts`. If this page and those functions disagree, the functions are wrong until they are fixed to match this page.

## Trade

| Field | Value |
| --- | --- |
| Broker | Kalshi only |
| Tickets | `KXBTC15M`, `KXETH15M`, `KXSOL15M`, `KXGOLD15M` |
| Up | Buy the yes ticket |
| Down | Buy the no ticket |
| Chart | Kalshi 1-minute candles of that contract |
| Settlement check | Bitcoin `BRTI` 60-second average. Ether `ETHUSD_RTI`. Solana `SOLUSD_RTI`. Gold Pyth 1-minute close. That number pays the ticket. The drawing does not pay. |
| Size | $1 to $5 while cash is under $50. On a CPI, jobs, or Fed window, four times that clip. A second clip only if the new price is cheaper and 60 seconds have passed. Three losses pause every new order for 60 minutes. The day stops at $15 down. |
| Clock | Skip the first 20 seconds and the last 90 seconds. The shock window is a shot, not a sit. |

## Entry

The contract pays $1 or $0 when the official index finishes above or below Kalshi's line. The percent on the screen is the price of that side. It does not pick the side.

1. The day lean is the last 30 minutes of the official index. Up is up. Down is down. If that lean is missing, a live push through the line can be the lean. Flat and no push is a pass on that contract.
2. With the lean: the live print is on the same side of the line, and the move is bigger than the last minute's noise, or the last two candles engulf that way. Buy that side.
3. Counter-trend is allowed. The day lean is up, but the push has stalled at the high, and more than 3 minutes are left. Buy the down side. The mirror is allowed when the day lean is down. This does not cancel the day lean. It is only this contract.
4. On a normal window the ticket must cost 25¢ to 45¢. Above 45¢ you risk more than you can win. Under 25¢ is a long shot. A spread wider than 8¢ is a pass. No volume is a pass.
5. The last 90 seconds is a pass. The first 20 seconds is a pass. In the last 3 minutes the index also has to be at least twice the last minute's noise away from the line. A flat $10 gap is not used. During the 10 minutes before CPI, the jobs report, or a Fed decision, and the 15 minutes after, the ticket band changes to 20¢–40¢ and the clip is four times the normal clip. That window is a shot, not a sit.
6. $1 to $5 while cash is under $50. The cheap fast ticket gets the larger clip. On a CPI, jobs, or Fed window that clip is multiplied by four. A second clip only if the new price is cheaper than the first and 60 seconds have passed. No third. Three losses in a row pause every new order for 60 minutes, then the count resets. The day still stops at $15 down. When cash is over $50 the clip can grow to 10%, 15%, or 20%, and it never takes the whole balance. Gold stays in the scan.
7. A filled ticket is held to the clock. There is no mid-window sell.
8. Every order is immediate-or-cancel at the ask. Nothing rests one cent under. If it does not fill, it is cancelled.

Every new order pays the ask and cancels if it does not fill. A pass on one contract is not a pass on the day.

## Spark

Spark does not send the order. The model is `spark-2`. It reads the Fed, jobs, and inflation calendars. Those dates open the catalyst shot in rule 5. They do not pick up or down.

## Perps

A second engine. Kalshi margin only. Tickers: `KXGOLDPERP`, `KXBTCPERP`, `KXETHPERP`, `KXSOLPERP`, `KXXRPPERP`, `KXBNBPERP`, `KXSILVERPERP`, `KXUS500PERP`. Long is bid. Short is ask. The order is immediate-or-cancel on `POST /trade-api/v2/margin/orders`, inside an order group when Kalshi accepts one. A bracket stop goes to the cross-margin exit trigger: about 10% of the margin at risk, first target about 20%. Collateral per try is $25 to $35, and only if the margin account has at least $25. The 15-minute cash is not used. Three finished minutes have to point the same way, and the push has to be at least twice the recent noise. The bull/bear check in `src/lib/agent/tauric-debate.ts` kills a wide spread or a stop that sits inside that spread. Three losses in a row pause every order for 60 minutes, then the count resets. MiroFish is the swarm on port 5001. Its memory is Zep Cloud (`ZEP_API_KEY` on that process). Its model is an OpenAI-compatible key (`LLM_API_KEY` on that process). This desk does not use DuckDB, Supabase, or Notion for that memory, and it does not invent a probability when the swarm is down. The client speaks `/api/graph`, `/api/simulation`, and `/api/report`. Five minutes before CPI, jobs, or the Fed, the note says the volatility window is opening.

## Not in this rule

Coinbase and Yahoo draw the chart only. They do not send the order. Binance and Polymarket do not enter. A perpetual price is not allowed to settle a 15-minute ticket. Martingale is not used.

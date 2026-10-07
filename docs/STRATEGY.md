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
| Clock | Active from second 6 through second 870 of the 900-second window. Resting orders are pulled at 30 seconds before settlement. The shock window is a shot, not a sit. |

## Entry

The contract pays $1 or $0 per contract when the official index finishes above or below Kalshi's line. The clip is not one contract. The order buys the whole contracts that fit in the clip: clip divided by the price, rounded down. A win pays that count in dollars. At 20¢ a $3 clip buys 15 contracts and pays $15. At 60¢ it buys 5 and pays $5. The screen multiple is about 1 divided by the price, before the fee. The fee on these tickets uses multiplier 1: round up of 0.07 times contracts times price times 1 minus price. The percent on the screen is the price of that side. It does not pick the side.

1. The side comes from the 1-minute settlement index, not a 30-second drift. A YES continuation needs the index above Kalshi's line and above the 20 EMA, with the 20 EMA at or above the 50 when both exist, and RSI under 70. A NO continuation is the mirror, and RSI must be above 30. An oversold RSI under 30 plus a bullish rejection or engulf can buy YES even while the index is still under the line. That is the cheap ticket. An overbought RSI over 70 plus a bearish rejection or engulf can buy NO. A bounce off the 0.618 retracement with a candle or the 20 EMA in agreement is also a take. If RSI and the 20 EMA are both missing, the book sits. The 30-minute lean does not have to agree. If 1-minute noise is above 200 basis points, the book sits. A quiet news feed does not sit the book.
2. If that 30-minute lean matches the print, the clip is full. If the lean is flat, missing, or the other way, the clip is half. That half clip is a scalp. It is still the side the index is already on.
3. A stall or a candle flip does not fade the print. The order follows the index versus the line.
4. The ticket must cost 4¢ to 75¢ on every window, including CPI, jobs, and the Fed. Both the bid and the ask have to be on the book. The width of the spread does not sit. Zero volume does not sit. A new window is often empty for the first minute. Above 75¢ the payout multiple is too small. Under 4¢ is a pass.
5. The last 30 seconds is a pass, and any resting order is pulled then. The first 5 seconds is a pass. The last-60-second distance check is only the fallback in rule 1, used when the 30-second print is missing. A flat $10 gap is not used. During the 10 minutes before CPI, the jobs report, or a Fed decision, and the 15 minutes after, the clip is four times the normal clip. The price band does not change. That window is a shot, not a sit. If the official index socket drops, Kalshi's own perp mark can pick the side only when that quote is 2 seconds old or newer. It is half the clip. It does not settle the ticket.
6. $1 to $5 while cash is under $50. The cheap fast ticket gets the larger clip. On a CPI, jobs, or Fed window that clip is multiplied by four. A second clip only if the new price is cheaper than the first and 60 seconds have passed. No third. Three losses in a row pause every new order for 60 minutes, then the count resets. The day still stops at $15 down. When cash is over $50 the clip can grow to 10%, 15%, or 20%, and it never takes the whole balance. Gold stays in the scan.
7. A filled ticket is held to the clock. There is no mid-window sell.
8. Every order is immediate-or-cancel at the ask. Nothing rests one cent under. If it does not fill, it is cancelled.

Every new order pays the ask and cancels if it does not fill. A pass on one contract is not a pass on the day.

## Spark

Spark does not send the order. The model is `spark-2`. It reads the Fed, jobs, and inflation calendars. Those dates open the catalyst shot in rule 5. They do not pick up or down.

## Perps

A second engine. Kalshi margin only. Tickers: `KXGOLDPERP`, `KXBTCPERP`, `KXETHPERP`, `KXSOLPERP`, `KXXRPPERP`, `KXBNBPERP`, `KXSILVERPERP`, `KXUS500PERP`. Long is bid. Short is ask. The order is immediate-or-cancel on `POST /trade-api/v2/margin/orders`, inside an order group when Kalshi accepts one. A bracket stop goes to the cross-margin exit trigger: about 10% of the margin at risk, first target about 20%. Collateral per try is $25 to $35, and only if the margin account has at least $25. The 15-minute cash is not used. Three finished minutes have to point the same way, and the push has to be at least twice the recent noise. A normal push uses 3x or 5x unless the slider on the perpetuals tab is lower. The slider is the ceiling. The debate in `src/lib/intelligence/tauric-debate.ts` may use less. It may not use more, and it may not flip the side the tape already picked. Only a push of at least three times the noise may use the contract maximum, and only if the slider is already there. Kalshi does not accept a leverage field on the order. Lower leverage means a smaller position for the same dollars, so the liquidation wick is farther away. The bull/bear check in `src/lib/agent/tauric-debate.ts` does not sit a wide spread. The MiroFish forecast in `src/lib/intelligence/mirofish-client.ts` can promote a push to the maximum when the crowd agrees, and it can kill the trade when the crowd strongly disagrees. If the swarm is down, the tape still decides. Three losses in a row pause every order for 60 minutes, then the count resets. MiroFish is the swarm on port 5001. Its memory is Zep Cloud (`ZEP_API_KEY` on that process). Its model is an OpenAI-compatible key (`LLM_API_KEY` on that process). This desk does not use DuckDB, Supabase, or Notion for that memory, and it does not invent a probability when the swarm is down. The client speaks `/api/graph`, `/api/simulation`, and `/api/report`. Five minutes before CPI, jobs, or the Fed, the note says the volatility window is opening.

## Not in this rule

Coinbase and Yahoo draw the chart only. They do not send the order. Binance and Polymarket do not enter. A perpetual price is not allowed to settle a 15-minute ticket. Martingale is not used.

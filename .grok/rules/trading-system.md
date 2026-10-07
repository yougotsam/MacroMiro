# Trading system

Approved features get implemented and tested. Do not dismiss one because another bot has no published fills.

Unproven ideas are experimental and stay in shadow mode. They do not place orders.

Live trading stays off until the settlement print matches the contract, the shadow log has a real sample, and a human turns the live flag on.

BTC settlement in the final minute is CF Benchmarks `last_60s_windowed_average_15min` when that window has 60 prints. The live decision uses the trailing 60-second average (`avg_60s_data`), not that quarter-hour field and not a Binance print.

Gold uses the Pyth GOLD 1-minute close named in the contract rules. A tick, a 401, or the wrong feed id blocks gold.

A missing credential blocks a live decision. It does not block the adapter, the stale check, or the tests.

A strategy score is not a probability. If the chance is not calibrated, label it Experimental estimate or return null.

Indicators confirm a thesis. One candle name, one RSI print, or one headline is not a trade.

Firecrawl news is async. It never runs inside the price loop and never places an order. A headline can veto or mark an experimental adjustment. It cannot trade by itself.

Every GET, including `/api/live/heart`, is read-only. Missing or stale data is NO TRADE.

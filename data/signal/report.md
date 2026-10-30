# Pre-trade score: measured report (2026-10-30T10:44:41.121Z)

82150 bars across BTC, ETH, SOL, XRP and gold (PAXG). 22 weekly walk-forward tests, 72081 scored out of sample.
Brier: model 0.24947 vs coin-flip 0.25000.

| Product | Trades | Win rate | Avg per contract/unit after fees | 95% range | Winning weeks | Verdict |
|---|---|---|---|---|---|---|
| prediction | 2673 | 55.3% | 2.53¢ | 0.09¢ … 4.97¢ | 16/22 | KEPT |
| perp | 41084 | 25.8% | -0.10¢ | -0.10¢ … -0.10¢ | 0/22 | not kept |

Prediction: passed: ≥200 trades, positive after fees with 95% confidence, beats base, most weeks positive

Perps: 95% interval low -0.0010 ≤ 0 after fees; only 0% of weeks positive

## Weights (log-odds per unit, measured)

- rsi: -0.1787
- release_mom: 0.1720
- mom1: -0.1699
- vwap: -0.0788
- adr_exhaust: 0.0785
- mom4: -0.0558
- kz_sweep: -0.0434
- ny_mom: -0.0329
- premium_discount: -0.0261
- tunnel: 0.0258
- sweep: 0.0229
- bos: -0.0213
- rsi_div: 0.0196
- london_mom: 0.0176
- kz_mom: -0.0153
- ob_retest: -0.0119
- tunnel_stack: 0.0086
- choch: -0.0065
- ema_stack: -0.0016
- fvg: 0.0011
- news_spark: 0.0000
- news_rates: 0.0000
- mirofish: 0.0000

Assumptions: Prediction fills assumed at 51¢ taker with quadratic fee; perps 0.10% round trip; label = next 15m close vs this close; gold uses PAXG-USD as its price.

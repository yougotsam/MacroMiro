# Pre-trade score: measured report (2026-10-30T23:58:36.058Z)

82303 bars across BTC, ETH, SOL, XRP and gold. 22 weekly walk-forward tests, 72251 scored out of sample.
Brier: model 0.24941 vs coin-flip 0.25000.

## 15-minute prediction contracts

| Trades | Win rate | Avg per contract after fees | 95% range | Winning weeks | Verdict |
|---|---|---|---|---|---|
| 3559 | 55.1% | 2.27¢ | 0.13¢ … 4.41¢ | 15/22 | KEPT |

passed: ≥200 trades, positive after fees with 95% confidence, beats base, most weeks positive

## Perpetuals (Sameer's rules, see perps-report.md)

Sameer's rules, 180 days: BTC -26.4%, ETH -25.5%, SOL -28.7%, XRP -27.9%, GOLD 0.8% after fees and funding; not kept (needs ≥200 trades and a positive result with 95% confidence)

## Release window (prediction trades, minutes from the nearest CPI / NFP / PPI / FOMC)

| Minutes | Trades | Avg per contract |
|---|---|---|
| -120 to -60 | 29 | -7.97¢ |
| -60 to -30 | 22 | 10.84¢ |
| -30 to -15 | 13 | 1.05¢ |
| -15 to 0 | 25 | -4.80¢ |
| 0 to 15 | 27 | -19.47¢ |
| 15 to 30 | 28 | -2.80¢ |
| 30 to 60 | 26 | 1.05¢ |
| 60 to 120 | 36 | 19.42¢ |
| 120 to 240 | 59 | -8.73¢ |
| 4h+ away | 3264 | 2.81¢ |

## Weights (log-odds per unit; measured unless listed under priors)

- release_drift: 0.1734
- rsi: -0.1612
- mom1: -0.1546
- mirofish: 0.1500 (prior)
- vwap: -0.1175
- adr_exhaust: 0.0952
- kz_sweep: -0.0637
- ny_mom: -0.0626
- release_mom: 0.0558
- bos: -0.0405
- tunnel: 0.0378
- london_mom: 0.0333
- kz_mom: -0.0293
- premium_discount: -0.0253
- rsi_div: 0.0183
- sweep: 0.0180
- fvg: -0.0147
- mom4: 0.0115
- ob_retest: -0.0073
- ema_stack: 0.0040
- choch: 0.0034
- tunnel_stack: -0.0027
- news_spark: 0.0000 (prior)
- news_rates: 0.0000
- tone_asset: 0.0000
- tone_macro: 0.0000

Priors:
- mirofish = 0.1500: documented prior: no scored history yet (see config.ts); replaced by a measured weight after 30 scored runs
- news_spark = 0.0000: the Spark card is a live read of the same headlines; it borrows the measured tone_asset weight

Assumptions: Prediction fills assumed at 51¢ taker with quadratic fee (checked by scripts/fills-vs-51.ts); label = next 15m close vs this close; gold = OKX XAU-USDT-SWAP (spot-gold perp). Perps verdict comes from the rules backtest, not this fit. News: official BLS/Fed release times and GDELT headline tone, both public and free.

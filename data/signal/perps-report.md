# Perps backtest, Sameer's rules (2026-10-30T23:58:33.252Z)

Each series starts at $1,000. Stop costs 8% of the pile; half off at 1R, stop to entry, trail 1R; three losses in a row end the day; down 25% stops the series.
Entry rests on the bid (long) / ask (short) and fills only if price trades through it. Fees: crypto 0.02% maker / 0.04% taker; gold 0.0012% / 0.0024%. Funding at 00/08/16 New York using OKX prints (Kalshi's history is blocked here).
Gold uses OKX XAU-USDT-SWAP 15m (tracks spot gold). Dates: last ~180 days of bars.

| Variant | Series | Trades | Win | Avg R | Return after fees | Fees | Funding | Worst drawdown | Stopped |
|---|---|---|---|---|---|---|---|---|---|
| Sameer setup, 8h hold (live plan) | BTC | 79 | 48% | -0.20 | -26.4% | 20.0% | 0.00% | 33.3% | yes (−25%) |
| Sameer setup, 1h hold | BTC | 101 | 41% | -0.15 | -25.2% | 26.9% | 0.00% | 27.6% | yes (−25%) |
| Sameer setup, 4h hold | BTC | 79 | 48% | -0.19 | -25.8% | 20.4% | 0.00% | 33.1% | yes (−25%) |
| Sameer setup, 24h hold | BTC | 69 | 51% | -0.14 | -25.2% | 17.5% | 0.00% | 36.1% | yes (−25%) |
| Sameer setup, 8h, target 2R | BTC | 79 | 48% | -0.20 | -25.9% | 20.1% | 0.00% | 33.4% | yes (−25%) |
| Sameer setup, 8h, funding ×3 | BTC | 79 | 48% | -0.20 | -26.4% | 20.0% | 0.00% | 33.3% | yes (−25%) |
| Sameer setup, 8h, news block −15/+30 | BTC | 68 | 49% | -0.20 | -26.9% | 17.0% | 0.00% | 32.9% | yes (−25%) |
| Sameer setup, 8h, tone veto z>1 | BTC | 79 | 48% | -0.20 | -26.4% | 20.0% | 0.00% | 33.3% | yes (−25%) |
| AEIOU 4H/1H bias + 15m trigger, 8h | BTC | 38 | 39% | -0.17 | -16.2% | 9.5% | 0.04% | 29.1% | no |
| AEIOU, 24h hold | BTC | 22 | 41% | -0.34 | -27.0% | 5.4% | 0.00% | 28.6% | yes (−25%) |
| AEIOU, prompt exits (TP1 1.5–2R, TP2 3R) | BTC | 7 | 14% | -0.73 | -25.3% | 1.7% | 0.00% | 25.3% | yes (−25%) |
| AEIOU, 8h, news block −15/+30 | BTC | 38 | 39% | -0.17 | -16.2% | 9.5% | 0.04% | 29.1% | no |
| Sameer setup, 8h hold (live plan) | ETH | 62 | 52% | -0.11 | -25.5% | 16.4% | 0.00% | 37.0% | yes (−25%) |
| Sameer setup, 1h hold | ETH | 103 | 46% | -0.07 | -25.2% | 26.3% | 0.00% | 32.3% | yes (−25%) |
| Sameer setup, 4h hold | ETH | 67 | 51% | -0.12 | -26.0% | 18.9% | 0.00% | 37.2% | yes (−25%) |
| Sameer setup, 24h hold | ETH | 74 | 53% | -0.09 | -25.3% | 21.1% | 0.00% | 48.8% | yes (−25%) |
| Sameer setup, 8h, target 2R | ETH | 63 | 51% | -0.10 | -26.1% | 16.6% | 0.00% | 39.0% | yes (−25%) |
| Sameer setup, 8h, funding ×3 | ETH | 62 | 52% | -0.11 | -25.5% | 16.4% | 0.00% | 37.0% | yes (−25%) |
| Sameer setup, 8h, news block −15/+30 | ETH | 63 | 51% | -0.12 | -29.3% | 17.0% | 0.00% | 40.2% | yes (−25%) |
| Sameer setup, 8h, tone veto z>1 | ETH | 62 | 52% | -0.11 | -25.5% | 16.4% | 0.00% | 37.0% | yes (−25%) |
| AEIOU 4H/1H bias + 15m trigger, 8h | ETH | 38 | 66% | 0.35 | 70.9% | 13.0% | 0.07% | 15.7% | no |
| AEIOU, 24h hold | ETH | 34 | 62% | 0.30 | 45.1% | 9.7% | 0.20% | 21.9% | no |
| AEIOU, prompt exits (TP1 1.5–2R, TP2 3R) | ETH | 34 | 56% | 0.29 | 33.8% | 9.7% | 0.20% | 21.8% | no |
| AEIOU, 8h, news block −15/+30 | ETH | 38 | 66% | 0.35 | 70.9% | 13.0% | 0.07% | 15.7% | no |
| Sameer setup, 8h hold (live plan) | SOL | 129 | 52% | -0.09 | -28.7% | 34.9% | -0.03% | 47.4% | yes (−25%) |
| Sameer setup, 1h hold | SOL | 61 | 48% | -0.10 | -25.1% | 15.8% | 0.00% | 27.8% | yes (−25%) |
| Sameer setup, 4h hold | SOL | 135 | 54% | -0.08 | -27.3% | 35.4% | -0.03% | 38.0% | yes (−25%) |
| Sameer setup, 24h hold | SOL | 89 | 51% | -0.14 | -29.2% | 23.0% | 0.00% | 42.1% | yes (−25%) |
| Sameer setup, 8h, target 2R | SOL | 128 | 52% | -0.09 | -28.4% | 33.8% | -0.03% | 46.7% | yes (−25%) |
| Sameer setup, 8h, funding ×3 | SOL | 129 | 52% | -0.09 | -28.6% | 34.9% | -0.09% | 47.3% | yes (−25%) |
| Sameer setup, 8h, news block −15/+30 | SOL | 129 | 52% | -0.09 | -28.2% | 34.9% | -0.03% | 47.1% | yes (−25%) |
| Sameer setup, 8h, tone veto z>1 | SOL | 129 | 52% | -0.09 | -28.7% | 34.9% | -0.03% | 47.4% | yes (−25%) |
| AEIOU 4H/1H bias + 15m trigger, 8h | SOL | 29 | 45% | -0.24 | -11.6% | 7.2% | 0.02% | 30.0% | no |
| AEIOU, 24h hold | SOL | 28 | 46% | -0.27 | -14.8% | 6.5% | 0.02% | 27.1% | no |
| AEIOU, prompt exits (TP1 1.5–2R, TP2 3R) | SOL | 17 | 24% | -0.56 | -25.3% | 3.9% | 0.00% | 25.3% | yes (−25%) |
| AEIOU, 8h, news block −15/+30 | SOL | 29 | 45% | -0.24 | -11.6% | 7.2% | 0.02% | 30.0% | no |
| Sameer setup, 8h hold (live plan) | XRP | 76 | 50% | -0.11 | -27.9% | 18.9% | 0.00% | 38.0% | yes (−25%) |
| Sameer setup, 1h hold | XRP | 88 | 42% | -0.14 | -27.5% | 24.2% | 0.00% | 39.1% | yes (−25%) |
| Sameer setup, 4h hold | XRP | 137 | 45% | -0.11 | -26.7% | 33.4% | 0.02% | 37.4% | yes (−25%) |
| Sameer setup, 24h hold | XRP | 71 | 46% | -0.12 | -27.4% | 18.8% | 0.00% | 44.1% | yes (−25%) |
| Sameer setup, 8h, target 2R | XRP | 73 | 51% | -0.12 | -25.8% | 17.5% | 0.00% | 32.7% | yes (−25%) |
| Sameer setup, 8h, funding ×3 | XRP | 76 | 50% | -0.11 | -27.9% | 18.9% | 0.00% | 38.0% | yes (−25%) |
| Sameer setup, 8h, news block −15/+30 | XRP | 76 | 50% | -0.11 | -27.9% | 18.9% | 0.00% | 38.0% | yes (−25%) |
| Sameer setup, 8h, tone veto z>1 | XRP | 76 | 50% | -0.11 | -27.9% | 18.9% | 0.00% | 38.0% | yes (−25%) |
| AEIOU 4H/1H bias + 15m trigger, 8h | XRP | 9 | 11% | -0.54 | -27.1% | 1.7% | 0.00% | 27.1% | yes (−25%) |
| AEIOU, 24h hold | XRP | 4 | 0% | -1.05 | -25.2% | 0.8% | 0.00% | 25.2% | yes (−25%) |
| AEIOU, prompt exits (TP1 1.5–2R, TP2 3R) | XRP | 4 | 0% | -1.05 | -25.2% | 0.8% | 0.00% | 25.2% | yes (−25%) |
| AEIOU, 8h, news block −15/+30 | XRP | 9 | 11% | -0.55 | -27.1% | 1.8% | 0.00% | 27.1% | yes (−25%) |
| Sameer setup, 8h hold (live plan) | GOLD | 232 | 49% | -0.04 | 0.8% | 4.3% | 0.71% | 25.1% | no |
| Sameer setup, 1h hold | GOLD | 259 | 45% | -0.09 | -19.6% | 4.1% | -0.06% | 23.1% | no |
| Sameer setup, 4h hold | GOLD | 249 | 49% | -0.08 | -14.9% | 3.9% | 0.34% | 22.8% | no |
| Sameer setup, 24h hold | GOLD | 217 | 49% | -0.05 | -24.2% | 3.4% | 0.78% | 30.7% | no |
| Sameer setup, 8h, target 2R | GOLD | 235 | 49% | -0.04 | -3.8% | 4.1% | 0.71% | 24.6% | no |
| Sameer setup, 8h, funding ×3 | GOLD | 232 | 49% | -0.04 | -0.4% | 4.3% | 2.14% | 26.4% | no |
| Sameer setup, 8h, news block −15/+30 | GOLD | 232 | 49% | -0.04 | -0.3% | 4.3% | 0.71% | 25.9% | no |
| Sameer setup, 8h, tone veto z>1 | GOLD | 232 | 49% | -0.04 | 0.8% | 4.3% | 0.71% | 25.1% | no |
| AEIOU 4H/1H bias + 15m trigger, 8h | GOLD | 6 | 50% | 0.15 | 0.8% | 0.1% | 0.00% | 3.1% | no |
| AEIOU, 24h hold | GOLD | 6 | 50% | 0.13 | 0.5% | 0.1% | 0.00% | 3.0% | no |
| AEIOU, prompt exits (TP1 1.5–2R, TP2 3R) | GOLD | 6 | 50% | 0.26 | 2.4% | 0.1% | 0.00% | 3.0% | no |
| AEIOU, 8h, news block −15/+30 | GOLD | 6 | 50% | 0.15 | 0.8% | 0.1% | 0.00% | 3.1% | no |

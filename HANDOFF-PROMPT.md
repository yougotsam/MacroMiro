You are picking up the MacroMiro Kalshi desk on `main` of https://github.com/yougotsam/MacroMiro.git. Read `HANDOFF.md`, `docs/STRATEGY.md`, and `src/lib/scan/edge.ts` before changing a rule. `edge.ts` wins if a skill disagrees.

This is a 15-minute binary desk for KXBTC15M, KXETH15M, KXSOL15M, and KXGOLD15M. Do not move it to perpetuals.

The live trigger is 1-minute index structure, not a 30-second drift. Continuation YES: index above the strike and above the 20 EMA, 20 at or above the 50, RSI under 70. NO is the mirror with RSI above 30. A cheap YES is allowed under the strike only when RSI is under 30 and the last index candle is a bullish rejection or engulf. A NO fade needs RSI over 70 and a bearish candle. A 0.618 bounce needs that zone plus a candle or the 20 EMA. Missing RSI and 20 EMA sits. Price band is 4¢–75¢. Spread width does not sit. The 30-minute lean only changes clip size.

Node 22. Tests: `npm test` (not Vitest). Secrets are names in `.grok/secrets/` (`kalshi_live`, `kalshi_begin`, `kalshi_key_id`, `kalshi_private.pem`). Do not commit them or `data/`. Both live switches were already 1. Heart worker is `scripts/heart-worker.sh`. The server interval must not send orders.

Next watch is one live 15-minute window: the log should name `20-EMA`, `RSI bounce`, `RSI fade`, or `fib 0.618`, and a Bitcoin order should print `[ORDER] POST` without a 404 on all three shards.

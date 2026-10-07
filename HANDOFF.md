# HANDOFF — Kalshi 15-minute desk

## 1. Project summary

MacroMiro is a live Kalshi desk for four 15-minute up/down contracts: Bitcoin, Ethereum, Solana, and Gold. A 15-second heart loop reads the open market, the official settlement index, and the 1-minute structure of that index, then sends an immediate-or-cancel order when the structure and the 4¢–75¢ ticket agree.

Stack: TypeScript on Node 22, TanStack Start / Vite, tests with `node --test` (not Vitest). Orders go to Kalshi trade-api v2 with an RSA-signed request. The heart is `scripts/heart-worker.sh` posting `tick: true` to `/api/live/heart` every 15 seconds. A second timer in the server only scans.

Perpetual margin code exists and is called at the end of a tick. It is not the current job. Do not move the desk onto perps until the 15-minute path has been watched through a live window with the new structure rules.

## 2. Context brief

Settled. Do not reopen these.

- The contract pays $1 per contract, not $1 for the whole clip. Count is `floor(clip / price)`. A win pays that count in dollars.
- Price band is 4¢ to 75¢ on the side being bought. Both 4¢ and 75¢ pass. Spread width does not sit. A missing bid or ask still sits.
- Direction is no longer "spot versus the strike plus a 30-second drift." That drift was the hole. `spot30` is still stored and is not a gate.
- Continuation YES: index above the strike, above the 20 EMA, 20 EMA at or above the 50 when both exist, RSI under 70.
- Continuation NO: the mirror, RSI above 30.
- Cheap YES snipe: RSI under 30 and a bullish rejection or engulf, even if the index is still under the strike. That is how a 4¢–15¢ ticket can fire. A bare RSI print does not.
- NO fade: RSI over 70 and a bearish rejection or engulf.
- Fib: last close within 8% of the 0.618 retracement of the recent range, plus a candle or the 20 EMA in the same direction.
- If RSI and the 20 EMA are both missing, sit `indicators unread`. Do not fall back to the 30-second test.
- The 30-minute lean only sizes the clip. Match is full. Flat, missing, or opposite is half. It does not pick the side.
- Cash under $50 uses $5 at or under 35¢ and $3 above that, then the half or the 4× shock. Cash at $50 or more uses 15% of cash, clamped $5–$15. Shard-2 cash was about $62, so a full clip is about $9 until the balance moves.
- Day stop on the 15-minute book is $15 in `kill.server.ts`. The $24 figure is only inside the unused-for-now perp function. Open 15-minute clips stop at $20. Cash at or under $8 stops the live book. Three losses pause 60 minutes. Two `MISS` notes bench that ticker. A 404 is a `SKIP` and does not bench it.
- News, Tauric, and Alexandria do not sit a 15-minute ticket. The experimental skill pipeline can still veto itself. It does not send the order.
- Orders omit `exchange_index` first, then retry `-1`, then `2`. The ticker is `live.ticker` from the open market. Never build the ticker from the clock.
- A fill is held to the window. There is no mid-window sell.
- RSI, EMA, and Fib are computed on the settlement index minutes (`indexStructure` in `src/lib/skill/ta.ts`), not on the Kalshi ticket candles.

## 3. Repo and environment

- Repo: https://github.com/yougotsam/MacroMiro.git
- Branch: `main`
- Start at the commit this handoff was pushed with. Run `git log -1`.
- Runtime: Node v22.23.2. Install with `npm install`. Test with `npm test`. There is no Vitest script. `bunx vitest run` is the wrong command.
- Dev server: port 8080 via `/workspace/startup.sh`. The heart worker is `scripts/heart-worker.sh`.

Secret names only. Files live in `.grok/secrets/` and are not in git.

| File | Use |
| --- | --- |
| `kalshi_live` | `1` allows the live path |
| `kalshi_begin` | `1` allows orders to leave |
| `kalshi_key_id` | Kalshi API key id |
| `kalshi_private.pem` | RSA private key |
| `tg_token`, `tg_chat` | Optional Telegram fill ping |
| `pm_us_key_id`, `pm_us_secret`, `pm_us_live` | Polymarket. Not this desk. |
| `fc`, `jup` | Other connectors. Not the 15-minute order. |

Both Kalshi switches were `1` when this handoff was written. Live state is `data/heart.json` and `data/kill.json`. Logs are `data/scan.log`. Do not commit those.

## 4. Task handoff

Done

- Spread-width rejects removed from the 15-minute path, the perp scan, the bull/bear check, and the 5-minute display row.
- Price band is 4¢–75¢ in `edge.ts`, `heart.server.ts`, `exec.ts`, and `kalshi-order.ts`.
- `kalshi.ts` passes RSI, EMA 20/50, fib zone, engulf, and wick rejection from the index into `edgeDecision`.
- `npm test`: 108 passed, 0 failed.

Next

- Watch one full 15-minute open. The first 20 closed index minutes are required before the 20 EMA exists. Until then the log should say `indicators unread` or `no structure`, not a blind buy.
- Confirm a qualified line names the trigger: `20-EMA breakout`, `RSI bounce`, `RSI fade`, or `fib 0.618 bounce`.
- Confirm the next Bitcoin post logs `[ORDER] POST` and does not 404 on all three shards.

Not next: wiring a second technical suite into `/margin/orders`.

## 5. Session kickoff

Paste the block in `HANDOFF-PROMPT.md` if you want the short version. The long version is this file. Read `docs/STRATEGY.md` and `src/lib/scan/edge.ts` before editing a rule. If a sentence in a skill disagrees with `edge.ts`, `edge.ts` wins. Then update the sentence.

## 6. Gotchas

- Two 15-second loops. The server interval scans and logs `HOLD (scan only)`. Only the worker with `tick: true` may send.
- `clip.ts` still has a $300 paper start and a $150 paper stop. Those apply only when the live flag is off. `sniperClip` in that same file is the live sizer.
- `MAX_PER_TICKER_USD` is $10 and nothing reads it. The live exposure stop is $20.
- A 404 is logged as `SKIP`. It does not count toward the two-miss bench.
- Gold's decision price is the last finished Pyth minute, not the live tick. The log can show a newer tick than the price the decision used.
- Ticket candles are not the structure. Volume from the ticket is a note. The candle that gates the trade is the index candle.
- `evaluatePerpEdge` still has a $24 day shield and a Tauric score gate. That function is not the 15-minute brain.
- The chart EMA settings in `src/lib/live/indicators.ts` are still 7 and 14. The order uses 20 and 50. Do not "fix" one to match the other without meaning to change the trade.
- Tests are `npm test`. Do not add Vitest to satisfy an old instruction.
- Do not print Kalshi auth headers. The order log says `auth=signed-not-printed`.

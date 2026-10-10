# MacroMiro Sniper Desk V1: launch guide (paper only)

Real orders are impossible in this version: `CALIBRATED_MODEL_APPROVED=false`, the live/begin/arm switch files are off, the collector can only send GET requests, and no trading engine is started. Never run `/workspace/startup.sh` for this.

## 1. Start (one time per machine restart)

From `/workspace/desk/MacroMiro`:

| What | Command | Notes |
|---|---|---|
| Web app | `npm run dev` | opens on port 8080 |
| Market collector (read-only) | `DESK_DATA_DIR=/workspace/data/desk-observe bun scripts/desk-observe.ts` | needs the Kalshi read key in the environment. Check first that it is not already running: `pgrep -af desk-observe.ts` |
| Paper engine | `npm run paper:loop` | rebuilds candidates and paper P&L every 60 s, 0 credits |

## 2. Open

**http://localhost:8080/paper**. On the box preview, use the 8080 preview URL.

You will see:
- markets and feed health (stale or closed markets are red)
- ranked opportunities right now, with every number behind the ranking
- paper results for each config, in USD after Kalshi fees
- the latest paper entries and how each one settled
- research relevance

Firecrawl and research status: http://localhost:8080/intel-grid

## 3. On / off

On the paper page, use the three buttons: **Standby**, **Observation** and **Paper research**. You can also use the command line:

- `bun scripts/ops/mode.ts set FULL_STANDBY`
- `bun scripts/ops/mode.ts set MARKET_DATA_ONLY`
- `bun scripts/ops/mode.ts set RESEARCH_PAPER`
- `bun scripts/ops/mode.ts status`

None of these can send an order, and none of them turns on paid Firecrawl research.

To stop the paper engine: `kill $(cat /workspace/data/paper/paper-loop.pid)`.

## 4. View paper trades

- **On the page:** the "Paper results by config" section. Click a config to see its latest entries: side, price × quantity, fee, outcome and net USD.
- **Raw file:** `/workspace/data/paper/paper-latest.json`
- **One-off refresh:** `npm run paper`
- **Statistical evaluation:** `npm run desk:evaluate`

## 5. Confirm no real orders can be sent

Run `bun scripts/ops/no-orders-check.ts`. It must print `"verdict": "NO REAL ORDERS POSSIBLE"`. It shows:
- `CALIBRATED_MODEL_APPROVED`: false
- the live/begin/arm switches: all false
- the collector's GET-only network counter: `refused` stays 0 because it never tries anything else
- the number of engine processes: 0

## How to read the numbers

- **Model P is EXPERIMENTAL.** It is the settlement model's probability, and it has no owner-approved calibrator yet. A calibrated probability will appear only after approval.
- **EV:** quantity × (model P − ask) − Kalshi fee.
- **Paper P&L:** $1 payout per winning contract, minus cost, minus fee. Each contract gets at most one entry, capped at $3.
- **Sample size:** results are labelled PRELIMINARY until there are 200 independent settlement windows. The four coins sharing one settlement time count as one window.

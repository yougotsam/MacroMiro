# MacroMiro desk

This page is the paper screen. It does not send an order.

Live sends are elsewhere. A 15-minute contract leaves through the desk engine when the three switches are on. `CALIBRATED_MODEL_APPROVED` is true. A perpetual leaves through `POST /api/live/perp-fire` with that contract's leverage and a stop. The two balances do not share cash.

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

On the paper page, use the three buttons: **STANDBY**, **OBSERVATION** and **PAPER_RESEARCH**. They control only the research layer. The top badges show, separately: **Kalshi collection** (RUNNING while the collector is ticking, in every mode), **Paid Firecrawl research** (always OFF in V1: 0 credits, no open round), and **Paper engine**. You can also use the command line:

- `bun scripts/ops/mode.ts set FULL_STANDBY`
- `bun scripts/ops/mode.ts set MARKET_DATA_ONLY`
- `bun scripts/ops/mode.ts set RESEARCH_PAPER`
- `bun scripts/ops/mode.ts status`

None of these can send an order, and none of them turns on paid Firecrawl research.

### Stop / restart
- Stop the paper engine: `kill $(cat /workspace/data/paper/paper-loop.pid)`. Restart: `nohup npm run paper:loop >> /workspace/data/paper/paper-loop.log 2>&1 & echo $! > /workspace/data/paper/paper-loop.pid`
- Stop the collector: `pkill -f scripts/desk-observe.ts`. Restart it with the command in section 1, and only once (`pgrep -af desk-observe.ts` should show one). After a restart it reloads every observed contract that has no result yet, so no outcome is lost. For older gaps, run `bun scripts/paper/recover-outcomes.ts`, which uses public GET requests only.
- Web app: stop with Ctrl-C, start with `npm run dev`.
- Note: the box pauses while no agent is active, and collection stops during those pauses.

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

- **13-pt confluence** shows a state. **VALID_SCORE** and **TRUE_ZERO** are real scores. **NOT_READY** means warm-up is missing (fewer than 60 completed 15m bars or 205 completed 1h bars), and it never displays as 0/13. **INVALID_DATA** means the points do not add up. `bun scripts/paper/confluence-diag.ts` shows bar counts and missing conditions for each market. **CORE 9+** is the production eligibility. The **B7** config (7+) is a research comparison only, and no threshold was changed.
- **Rank (experimental)** is the blue badge. It is a ranking score, not the 13-pt confluence and not a probability.
- **Configs:** A settlement baseline, B first setup, B7 research 7+, B9 core 9+, C time-aware highest-ranked, D high-conviction by expiry bucket, E C + pre-entry research.
- **Unrestricted vs realistic portfolio:** "Unrestricted" takes every pick. "Realistic" enforces $3/ticker, $9 total, $4 same-direction crypto and the −$15 daily stop, in time order.
- **No candidate** appears when the event fee is unknown or when the model probability is pinned at its 2%/98% clamp.

- **Model P is EXPERIMENTAL.** It is the settlement model's probability, and it has no owner-approved calibrator yet. A calibrated probability will appear only after approval.
- **EV:** quantity × (model P − ask) − Kalshi fee.
- **Paper P&L:** $1 payout per winning contract, minus cost, minus fee. Each contract gets at most one entry, capped at $3.
- **Sample size:** results are labelled PRELIMINARY until there are 200 independent settlement windows. The four coins sharing one settlement time count as one window.

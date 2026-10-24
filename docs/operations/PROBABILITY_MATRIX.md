# How this desk gets a number

Written 2026-10-15. Read with `docs/operations/INTELLIGENCE_AUDIT.md`.
This file defines the numbers. The audit says which file can change a decision. If they disagree, fix both in the same commit.

Sources checked: the repo, MiroFish `report_agent.py`, OASIS arXiv 2411.11581, the Research+ connect page, and a live Research+ search. No paid scrape. No new swarm run.

## Three different numbers

| Name | What it actually is | Where | Can it send an order today? |
|---|---|---|---|
| 15-minute chance | Math on the settlement index versus the strike, then `tradeLogit` and `intelligenceLogit` | `src/lib/desk/settlement.ts`, `features.ts`, `intel-gate.ts` | Yes, when the three switches are on, the edge clears, and `risk.check` passes. `CALIBRATED_MODEL_APPROVED` is true. `APPROVAL_POLICY_ENFORCED` is false, so the calibrator file is not required |
| Technical score | 0–13 setup points, including one official-calendar point | `src/lib/desk/sniper.ts` | No. Points are not a probability |
| Perps chance | Not estimated. The scorer labels every report UNKNOWN | `src/lib/perps/prob-edge.ts` | No. Break-even is a cost identity, not a win rate |
| Report claim | A labeled sentence scraped from a MiroFish story | `probabilityFromReport` in `src/lib/intel/mirofish.ts` | No. The order files are not allowed to import it |

`FEATURE_MAX_SHIFT` is 0.04 and only caps `featureShift`. The live tilt is `tradeLogit`: 0.80, 0.45, or 0.16 times the feature magnitude. A chart that names the other side sits the ticket. A chart that names nothing does not. The nine names in `src/lib/grid/features.ts` are a different list. Each of those weights is hardcoded 0.

## What MiroFish really does

MiroFish stays. It is a scenario simulator.

1. A seed (a Spark card plus a Firecrawl article) can be sent to a separate program on port 5001.
2. That program builds a graph of names in the seed (Zep, on that program).
3. OASIS lets those names post, like, follow, or do nothing. There is no bet.
4. `report_agent.py` writes markdown. It has no probability field and it does not count votes.
5. Our reader keeps a line that says `Probability:` or `概率`. "80% of agents" is ignored. No labeled line means null. The original line is kept beside the number (`probabilityLine`).

That number is an uncalibrated report claim. It is not P(gold up) and not P(the contract settles YES).

The last local file had probability `null` because the swarm was not running. Do not invent votes for that run. Do not start a new paid run from this note.

## What the science says

OASIS (arXiv 2411.11581) measures rumor spread, polarization, and herd behavior. It does not publish a Brier score for event forecasts. Agents copy each other, and a bigger crowd herds harder.

A public October 5, 2026 write-up of 24 MiroFish runs on four Polymarket questions ($5.96) said the swarm's middle answers sat between 20 and 55 while the markets sat between about 31% and 85%, and that the seed wording moved the result more than swapping the language model. Those markets were not settled on October 15, 2026. That write-up is not a scorecard. It is a warning that the prompt does the work.

https://arxiv.org/abs/2411.11581
https://github.com/666ghj/MiroFish/blob/main/backend/app/services/report_agent.py
https://orcalayer.com/blog/mirofish-ai-swarm-polymarket-experiment

## What our own tests already forbid

`src/lib/desk/research-context.test.ts` feeds a MiroFish probability of 0.97 and checks that 0.97 is gone from the context the desk may see.

`usableForSettlement` is the value `false`.

`src/lib/perps/intel.ts` records MiroFish with score 0. The official calendar is the exception: `macroClear` can add one sniper point. A headline cannot.

## Research+

https://research-plus.lovable.app/connect tells an assistant to use `https://research-plus.lovable.app/mcp`.

This assistant can call it. A paper search returned OASIS. A catalog search for a CFTC, CPI, or FOMC data tool returned nothing.

The trading repo does not call that address. Leave it that way. Research+ is for checking papers and claims. It is not a market-data feed, and it is not `https://mcp.lovable.dev`.

## Spark, Alexandria, Firecrawl

These stay. They are evidence inputs, not probabilities.

- An official release (the calendar, a printed number, a source URL, a time) can be tested later against outcomes.
- An AI summary of that release is an interpretation. Store it as an interpretation.
- A missing file or a file that arrives after the decision is UNKNOWN. It is not zero, and it is not a reason to skip the technical score.

## What a shadow row stores

Do not fold a report claim into the 15-minute chance or into a perps win probability.

| Field | Rule |
|---|---|
| Market and decision time | The clock the rank used |
| Evidence available then | Source, time, and whether it was late |
| Technical baseline | The sniper score and the side, with no research |
| Research note | What would have changed the rank, or UNKNOWN |
| Original vs revised rank | Both. If they match, say so |
| Executable costs | Real bid, ask, fees. No invented fill |
| Outcome | Filled in only after settlement or after a real close |
| Report claim | The sentence, or null. Never a made-up vote share |

Brier score is only for a real probability against a real outcome. Net expectancy is only for real fills. One row proves the wire. It does not prove an edge.

## Side-quest board

`src/lib/omni/` reads open Kalshi events (tech, sports, culture, macro, crypto, perps) and ranks two price checks:

- Repricing: yes ask from 8¢ to 30¢. The written target is twice that ask, floored at 45¢ and capped at 75¢. That multiple is target divided by entry. It is not a promise the book will move.
- Bracket: if two or more yes asks on the same event sum to less than $1, the gap is flagged. The contract set may be incomplete, so this is a check, not a locked arbitrage.

Every row sets `winProbability` to `UNKNOWN`. The disk file `flip-ledger.json` stores the chosen bankroll preset ($100, $200, $500, $2,500, or the live cash read) and shadow notes. It does not add profit. It does not change the approved −$15 / $3 15-minute limits. MiroFish gets a five-role seed for that question and is told not to emit a settlement probability. Live sends stay off.


## Next coding job

SHADOW DECISION FUSION, from `main` after this documentation PR merges. Locks stay on. No paid swarm. No paid scrape unless the owner asks. The side-quest board above is already a read. It is not that fusion and it is not a live send.

# MacroMiro handoff for Grok Bot

Read this file before you change anything. Do not invent a second trading rule. Do not invent a MiroFish probability.

Repo: https://github.com/yougotsam/MacroMiro
Branch: main

## Where this is

This is a Kalshi desk. The 15-minute book and the perpetual book are separate. The preview you may have seen was a workshop computer, not the owner's laptop. Grok Bot has its own cloud computer. Clone this repo there. Keys are not in git.

## What already trades

The order decision is `src/lib/scan/edge.ts`. It uses the live settlement index, the 20 and 50 averages, RSI, the last candle, and a 30-second check. A ticket must be between 4 cents and 75 cents. Spread width does not block. Zero volume does not block. The day stops on dollars lost, at $15, not on a count of losing trades. Sizes stay small. A filled 15-minute ticket is held to the clock.

The chart draws the same 20 and 50 averages, the 0.618 line, and VWAP. The chart does not send the order.

Perpetuals are Kalshi margin only. They are not Hyperliquid. Kelly sizing is not used. Do not add either one back.

## What is not running

MiroFish is a phone, not the town. The phone is `src/lib/intel/mirofish.ts`. It calls port 5001. The town is a separate app: https://github.com/666ghj/MiroFish. Its folders were never copied into this repo. The Swarm tab only shows status. It does not send an order.

Zep's MCP does not replace that app. The docs door (https://docs-mcp.getzep.com/mcp) only reads Zep's manual. The context door (https://api.getzep.com/mcp) only opens a notebook that already has notes. Neither one runs a simulation.

Firecrawl and Alexandria already pull headlines. A headline is not a vote.

The Ask button calls xAI model `grok-4.5` only when `XAI_API_KEY` is present. Otherwise it uses the written rules. Gemini is not installed. There is no OpenAI package and no `server/lib` folder.

## Do not do these

- Do not let Gemini, Claude, or Grok override `edge.ts`.
- Do not paste a ModelManager that calls `grok-2` or `gemini-2.5-flash` and then ignores the answer.
- Do not fake CVD, a crowd percentage, or a MiroFish report.
- Do not put Groq, Zep, or Gemini keys into the order path.
- Do not stop the desk because MiroFish is down.

## Keys the owner must paste onto the Bot computer

These stay out of git and out of chat logs.

| Key | Where it goes | Used for |
| --- | --- | --- |
| Kalshi key id and private key | `.grok/secrets` on the Bot computer, same layout as this repo | Live orders. Already used by this desk. The owner copies them. |
| `XAI_API_KEY` | env on the Bot computer | Ask button. Coding model in the xAI docs is `grok-4.7`. The desk Ask line is still `grok-4.5` until someone changes that one line on purpose. |
| Groq or other model key, `LLM_BASE_URL`, `LLM_MODEL_NAME` | MiroFish `.env` only | The swarm's mouth. For Groq the base is `https://api.groq.com/openai/v1`. |
| `ZEP_API_KEY` | MiroFish `.env` only | The swarm's memory. Sign up at https://app.getzep.com/. There is no second database. |
| `GEMINI_API_KEY` | not wired | Optional later, screen-only second opinion. Model id is `gemini-3.8-flash`. Not "Perseus". |
| Firecrawl key | already expected as `.grok/secrets/fc` | Headlines only. |

## MiroFish, when the owner wants it

Official app needs Docker, or Python 3.11 or 3.12, plus Node 18. This workshop had Python 3.10 and no Docker, so it could not host the town. On the Bot computer:

1. Clone https://github.com/666ghj/MiroFish next to this repo, not inside it.
2. Copy `.env.example` to `.env` and fill the four lines above.
3. `npm run setup:all` then `npm run dev`.
4. Leave it open. Screen is port 3000. This desk dials port 5001.
5. Press Knock once on the Swarm tab. A blank probability is not a trade.

Start under 40 simulation rounds. It spends model money.

## First job for the Bot

Clone the repo. Read `docs/STRATEGY.md`, `docs/MIROFISH.md`, and this file. Confirm the 15-minute rule in `edge.ts` still matches those docs. Do not place an order until the owner says the Kalshi keys are on that computer and the day-loss counter is understood. Then report what is present, what is missing, and stop.

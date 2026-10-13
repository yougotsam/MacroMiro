# MiroFish (the swarm) on this desk

MiroFish is a separate program: [github.com/666ghj/MiroFish](https://github.com/666ghj/MiroFish), cloned at `/workspace/desk/MiroFish` (local branch `macromiro-desk`). This desk only has the client, `src/lib/intel/mirofish.ts`, which calls port 5001. The client never invents a crowd percentage and never sends an order. The 15-minute book does not read MiroFish (`src/lib/brain/brain.test.ts`).

## Its keys (MiroFish `.env` only, chmod 600, never in this repo)

| Name | Value on this desk |
| --- | --- |
| `LLM_API_KEY` | The Gemini API key (same one the desk's Ask button uses). |
| `LLM_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` (Gemini's OpenAI-compatible endpoint). |
| `LLM_MODEL_NAME` | `gemini-3.8-flash` |
| `ZEP_API_KEY` | The memory database ([app.getzep.com](https://app.getzep.com/)). There is no second database. |
| `OASIS_DEFAULT_MAX_ROUNDS` | `15`. Every run stays under 40 rounds; they spend model money. |

Fallback brain: `LLM_API_KEY=<xAI key>`, `LLM_BASE_URL=https://api.x.ai/v1`, `LLM_MODEL_NAME=grok-4.7`, then restart MiroFish.

Gemini note: Gemini 3 rejects a tool-call history that lacks its `thought_signature`, and the agent library MiroFish uses (camel-ai 0.2.78) drops that field. `backend/scripts/gemini_compat.py` (in the MiroFish branch) adds Google's documented placeholder signature only when `LLM_BASE_URL` is Gemini. Without it every agent step after the first fails with HTTP 400.

## What one Knock does (`POST /api/live/swarm {}`)

1. **seed**: the fresh Spark card (completed, under 6 h old) plus up to 5 news articles Firecrawl fetches for it (`src/lib/intel/seed.server.ts`), saved to `/workspace/data/mirofish-seed.md`. No fresh card means no Knock.
2. **world**: MiroFish reads the seed into an ontology and a Zep graph.
3. **setup**: graph entities become agents with personas.
4. **swarm**: agents post and react on a simulated Twitter, capped at `MIROFISH_MAX_ROUNDS` (15, never above 40).
5. **report**: a report agent writes a forecast. The desk keeps only an explicit `Probability: NN%` line, otherwise `null`.

Live view: `GET /api/live/swarm` (stage), `GET /api/live/swarm/feed?limit=50` (agent actions), `GET /api/live/swarm/stream` (SSE). Screen: port 3000.

## Private backend (since round 3.2)

The backend binds `127.0.0.1` only and every `/api/*` call needs `Authorization: Bearer $MIROFISH_AUTH_TOKEN` (token in the MiroFish `.env`, chmod 600, never printed; missing/short token fails closed with 503). The desk clients (`src/lib/intel/mirofish.ts`, `src/lib/research/*`) send it automatically. LLM calls go through the loopback cost meter (`scripts/llm-meter-proxy.ts`) when `MIROFISH_LLM_METER_URL` is set.

## Event research pipeline (round 3.2)

`scripts/research-pipeline.ts` runs scenario jobs (baseline/bullish/bearish/unexpected) for verified official-calendar catalysts only, never per 15-minute contract, and archives the report to Alexandria (`/workspace/data/research/`). Research output is context: it cannot place/cancel/authorize orders or feed a probability (enforced by tests), and `MIROFISH_FEATURES_APPROVED=false`. See `docs/MIROFISH_VERIFICATION.md`.

## Start

Do not run `/workspace/startup.sh` for research: it also starts the desk engine supervisor. Start the meter and backend by hand (see `docs/MIROFISH_VERIFICATION.md`). Until port 5001 answers, the 15-minute book and the collector keep running on their own.

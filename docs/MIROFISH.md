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

## Start

`/workspace/startup.sh` starts the desk, the heart worker and MiroFish (`/workspace/desk/run-mirofish.sh`). Until port 5001 answers, the 15-minute book keeps running on its own rule.

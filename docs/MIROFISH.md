# How to turn MiroFish on

MiroFish is a separate program. This desk only has the client, in `src/lib/intel/mirofish.ts`. The client knocks on port 5001. It does not invent a crowd percentage, and it does not send an order.

## What you need to give me

Four names. They belong in the MiroFish program's `.env`, not in this desk.

| Name | What it is |
| --- | --- |
| `LLM_API_KEY` | The model key. For Grok, that is an xAI key. |
| `LLM_BASE_URL` | For Grok, `https://api.x.ai/v1`. |
| `LLM_MODEL_NAME` | The model name xAI gave you. |
| `ZEP_API_KEY` | The memory database. Sign up at [app.getzep.com](https://app.getzep.com/). |

There is no second database. Zep is the memory. The program itself is [github.com/666ghj/MiroFish](https://github.com/666ghj/MiroFish).

## Once those exist

1. Copy `.env.example` to `.env` in that folder and fill the four lines.
2. Run `npm run setup:all`, then `npm run dev`.
3. Leave it open. The town is port 5001. The picture window is port 3000.
4. Come back here and press Knock once on the Swarm tab.

Until port 5001 answers, the 15-minute book keeps trading on the tape.

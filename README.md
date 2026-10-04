# Envelope

Kalshi desk. Two books. They do not share cash.

| What | Where |
| --- | --- |
| The rule | [docs/STRATEGY.md](docs/STRATEGY.md) |
| 15-minute tickets | `src/lib/scan/edge.ts` |
| Perpetuals | `src/lib/scan/perp-desk.ts` and `src/lib/scan/kalshi-perp-order.ts` |
| Bull against bear | `src/lib/agent/tauric-debate.ts` |
| Spark and Firecrawl | `src/lib/live/` |
| MiroFish client | `src/lib/intel/mirofish.ts` |
| How to start the swarm | [docs/MIROFISH.md](docs/MIROFISH.md) |
| Start the desk | `sh /workspace/startup.sh` |

`pipeline/` is an old side program. The live desk does not import it.

Keys live in `.grok/secrets`. Names only are in `.env.example`.

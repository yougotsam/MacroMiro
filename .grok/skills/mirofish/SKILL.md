---
name: mirofish
description: >
  How Envelope talks to MiroFish. Use when a headline should be simulated.
  Do not invent a probability if the swarm is down. Do not swap its memory
  for DuckDB, Supabase, or Notion.
---

# MiroFish

The client is `src/lib/intel/mirofish.ts`. It calls a separate program on port 5001. The steps are written for a person in `docs/MIROFISH.md`.

That program keeps memory in Zep Cloud (`ZEP_API_KEY`) and talks to a model with `LLM_API_KEY`. Both keys belong to that program. This desk only sends the headline and reads a probability back.

Paths: `/api/graph`, `/api/simulation`, `/api/report`. One step per pass. No number from the report means no probability.

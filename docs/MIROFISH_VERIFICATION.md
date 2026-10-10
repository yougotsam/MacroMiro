# MiroFish install verification (2026-10-09)

Checked against https://github.com/666ghj/MiroFish by reading the installed source, not by file presence.

| Item | Finding |
| --- | --- |
| Clone | `/workspace/desk/MiroFish`, branch `macromiro-desk`; upstream `origin/main` = `7657031` (0 commits behind after `git fetch`). Local commits on top: `8f31a96` (round cap, Gemini thought-signature shim), `7b2a39c` (private backend + cost meter hook), `37748b0` (`OASIS_START_HOUR`: the OASIS sim clock starts at 00:00 upstream, and agents are only active in their persona hours, so a short run at hour 0 produced almost no actions; default 0 keeps upstream behaviour). Not pushed anywhere. |
| Version | `package.json` / `backend/pyproject.toml`: 0.1.0 (AGPL-3.0). |
| Backend | Python Flask (`backend/run.py`, `app/__init__.py`), Python 3.12 venv via `uv sync` (`backend/.venv`, 7.2 GB). Deps verified installed: flask 3.1.2, openai 1.109.1, zep-cloud 3.25.0, camel-oasis 0.2.5, camel-ai 0.2.78, PyMuPDF 1.26.7. |
| OASIS | `camel-oasis` 0.2.5; simulations run as subprocesses (`backend/scripts/run_twitter_simulation.py` etc.), file IPC. |
| Zep | Zep Cloud only (`ZEP_API_KEY`; `ZEP_API_URL` is rejected by `Config.validate`). |
| LLM | Any OpenAI-compatible API: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME` (here Gemini `gemini-3.8-flash` via `generativelanguage.googleapis.com/v1beta/openai/`). Optional `LLM_BOOST_*`. |
| Auth (upstream) | NONE: no auth on any route, CORS `*`, default bind `0.0.0.0`, request bodies logged at debug. |
| Auth (this desk, `7b2a39c`) | Default bind `127.0.0.1` (refuses a non-loopback bind unless `MIROFISH_ALLOW_PUBLIC_BIND=1`); every `/api/*` needs `Authorization: Bearer $MIROFISH_AUTH_TOKEN` (constant-time compare; unset/short token → 503 fail closed); CORS limited to localhost origins; bodies no longer logged. Verified live: no token → 401, wrong token → 401, right token → 200. Token lives only in `MiroFish/.env` (chmod 600) and is never printed. |
| Real APIs used (from `backend/app/api/*.py`) | `POST /api/graph/ontology/generate` (multipart: files, simulation_requirement, project_name) → `project_id`; `POST /api/graph/build` → `task_id`; `GET /api/graph/task/<id>`; `GET /api/graph/project/<id>`; `POST /api/simulation/create`; `POST /api/simulation/prepare` + `/prepare/status`; `POST /api/simulation/start` (simulation_id, platform, max_rounds); `GET /api/simulation/<id>/run-status`; `POST /api/simulation/env-status`, `/stop`; `POST /api/report/generate` + `/generate/status`; `GET /api/report/<id>`. |
| Cost control | `MIROFISH_LLM_METER_URL` routes LLM calls through `scripts/llm-meter-proxy.ts` (127.0.0.1:5098), which records real `usage` per call (list price $0.75/M in, $3.75/M out) and refuses calls past the budget. Report agent limited with `REPORT_AGENT_MAX_TOOL_CALLS=2`, `REPORT_AGENT_MAX_REFLECTION_ROUNDS=1`. |

## Env vars needed (names only)
MiroFish: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME`, `ZEP_API_KEY`, `MIROFISH_AUTH_TOKEN` (all present).
Optional: `OASIS_DEFAULT_MAX_ROUNDS`, `OASIS_START_HOUR`, `REPORT_AGENT_MAX_TOOL_CALLS`, `REPORT_AGENT_MAX_REFLECTION_ROUNDS`, `MIROFISH_LLM_METER_URL`, `FLASK_HOST`, `FLASK_PORT`.
Desk side: `FIRECRAWL_API_KEY` (present), `MIROFISH_AUTH_TOKEN` or the MiroFish `.env`.

## Start / stop (box only, loopback)
```
# meter (hard budget)
METER_BUDGET_USD=0.90 bun scripts/llm-meter-proxy.ts 5098
# backend
cd /workspace/desk/MiroFish/backend && FLASK_HOST=127.0.0.1 OASIS_START_HOUR=9 MIROFISH_LLM_METER_URL=http://127.0.0.1:5098/generativelanguage.googleapis.com/v1beta/openai/ \
  REPORT_AGENT_MAX_TOOL_CALLS=2 REPORT_AGENT_MAX_REFLECTION_ROUNDS=1 .venv/bin/python run.py
# pipeline
bun scripts/research-pipeline.ts enqueue --kind cpi --scenario baseline --seed 1 --rounds 3 --budget 0.9
bun scripts/research-pipeline.ts run --one ; bun scripts/research-pipeline.ts dashboard
```
The frontend (`npm run frontend`, vite :3000) is not started. `/workspace/startup.sh` must not be run as-is: it starts the desk engine supervisor.

## Seeds
The seeder fetches the official release page for the catalyst (BLS `cpi.nr0`/`ppi.nr0`/`empsit.nr0`, Fed `fomccalendars`) with a direct GET; BLS rejects the Bun runtime's TLS client (403), so it falls back to plain `curl` (GET only, fixed args, no shell), then Firecrawl. A page that does not name the catalyst is dropped (the first real run was seeded with the BLS homepage because Firecrawl returned it; that run is archived as-is and flagged by its source title).

# Upstream

Vendored from https://github.com/666ghj/MiroFish at commit
`7657031ac01184afe2cb220f5ee3545573b5e843`, under its original LICENSE (see `LICENSE`).

Excluded: `.git`, `.env` (real keys), `node_modules`, `.venv`, `logs`, `__pycache__`, build outputs, uploads.
Local change: `.env.example` points at xAI Grok (`grok-4.7`). See `SETUP.md`.

## MacroMiro patches applied on top (from the desk fork, branch `macromiro-desk` @ `37748b0`)
- `8f31a96` cap rounds by default, twitter runs log actions, Gemini thought-signature shim
- `7b2a39c` private backend: loopback bind, bearer token on /api (`MIROFISH_AUTH_TOKEN`), local-only CORS, no request-body logging, optional LLM cost meter (`MIROFISH_LLM_METER_URL`)
- `37748b0` `OASIS_START_HOUR` so the sim clock can start at event time
MacroMiro's client (`src/lib/research/mirofish-auth.ts`) reads the token from `MIROFISH_ENV_FILE`; point it at `mirofish/.env`.

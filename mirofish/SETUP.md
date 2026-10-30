# MiroFish setup (box)
Location: mirofish/ (inside MacroMiro) (upstream 666ghj/MiroFish). Dependencies are installed: `npm run setup` and `uv sync` in backend/.

## Keys to add to mirofish/.env (copy from .env.example)
- `LLM_API_KEY=`   your xAI API key
- `LLM_MODEL_NAME=` an xAI Grok model name, e.g. `grok-4` (check https://docs.x.ai for current names)
- `ZEP_API_KEY=`   Zep Cloud key (free tier: https://app.getzep.com/)
- `LLM_BASE_URL=https://api.x.ai/v1` is already set to xAI's OpenAI-compatible endpoint
The backend will not start until LLM_API_KEY and ZEP_API_KEY are set (backend/run.py checks Config.validate()).

## Start
cd mirofish && mkdir -p logs
nohup bash -c 'cd backend && uv run python run.py' > logs/backend.log 2>&1 & echo $! > logs/backend.pid
nohup bash -c 'cd frontend && npm run dev -- --host 0.0.0.0' > logs/frontend.log 2>&1 & echo $! > logs/frontend.pid
Check: curl localhost:5001/health   (frontend: http://localhost:3000)

## Stop
kill $(cat logs/backend.pid logs/frontend.pid); pkill -f 'python run.py'; pkill -f vite

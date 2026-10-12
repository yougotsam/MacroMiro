# Ops runbook
- **Never** run `/workspace/startup.sh`. Never print keys. Do not edit operator switch files. Use explicit `git add` paths only.
- Kalshi 15m collector: `bun scripts/desk-observe.ts` (GET only). Paper loop: `bun scripts/paper/run.ts`. Check them with `ps` + the data dirs under `/workspace/data/`.
- Perps trace (read-only): `bun scripts/perps/trace.ts` → `/workspace/data/perps/trace-<ts>.json`. It needs the Kalshi signing env in the process environment.
- Pre-push: `bunx tsc --noEmit && bunx eslint . && bun test && bun run build`, then the secret scan (`git diff --cached | rg -i "BEGIN (RSA|PRIVATE)|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]"` must be empty) and `bun scripts/ops/no-orders-check.ts`.
- Box limitation: the box pauses when idle (clock froze during waits), so long collectors need an always-on worker (see the report's hosting comparison). Buy nothing without owner approval.
- Kalshi perps maintenance: Thursdays 3–5 AM ET. Funding prints at 04:00/12:00/20:00 UTC.
- Incident: set mode FULL_STANDBY, stop the loops, keep all data, write a note in `docs/operations/incidents/`.

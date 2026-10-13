# Ops runbook
- **Never** run `/workspace/startup.sh`. Never print keys. Do not edit operator switch files. Use explicit `git add` paths only.
- Kalshi 15m collector: `bun scripts/desk-observe.ts` (GET only). Paper loop: `bun scripts/paper/run.ts`. Check them with `ps` + the data dirs under `/workspace/data/`.
- Perps trace (read-only): `bun scripts/perps/trace.ts` → `/workspace/data/perps/trace-<ts>.json`. It needs the Kalshi signing env in the process environment.
- Pre-push: `bunx tsc --noEmit && bunx eslint . && bun test && bun run build`, then the secret scan (`git diff --cached | rg -i "BEGIN (RSA|PRIVATE)|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]"` must be empty) and `bun scripts/ops/no-orders-check.ts`.
- Box limitation: the box pauses when idle (clock froze during waits), so long collectors need an always-on worker (see the report's hosting comparison). Buy nothing without owner approval.
- Kalshi perps maintenance: Thursdays 3–5 AM ET. Funding prints at 04:00/12:00/20:00 UTC.
- Incident: set mode FULL_STANDBY, stop the loops, keep all data, write a note in `docs/operations/incidents/`.
- Perps collector (read-only WS): `nohup bun scripts/perps/collect.ts > $DATA_ROOT/perps/collector.log 2>&1 &`. Health: `$DATA_ROOT/perps/collector-status.json` (msgs, gaps, resyncs, reconnects, book ages). It stops when the box pauses; move it to an always-on worker once one is approved.
- Perps sim: `bun scripts/perps/sim.ts 21` (labelled CAUSAL REPLAY). Report/sizing/reconciliation demo: `bun scripts/perps/report.ts`. Intel trace: `bun scripts/perps/intel-trace.ts`. Pair scan: `bun scripts/kalshi-pair-scan.ts`.
- Demo: perps exist on demo (`external-api.demo.kalshi.co/trade-api/v2/margin`, public market data answers). Demo orders need a demo account plus demo API keys (owner step); production keys don't work there.

## Loop engineering (paper)
- Start watchdog: `cd /workspace/desk/MacroMiro && nohup bun scripts/loop/watchdog.ts > /workspace/data/loop/watchdog.log 2>&1 &`
- Check: `cat /workspace/data/loop/watchdog-heartbeat.json` (`at` must be < 3 min old) and `cat /workspace/data/loop/watchdog.pid`.
- If the heartbeat is stale, engines refuse new entries by design. Restart the watchdog; do not bypass.
- Memory: `/workspace/data/loop/STATE.md`. Details: `docs/operations/LOOP_ENGINEERING.md`.

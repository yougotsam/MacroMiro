#!/bin/bash
# Desk engine supervisor: keeps exactly one `bun scripts/desk-engine.ts` running (the ONLY process that places orders).
# Restarts on crash after 5 s. Exit code 3 = another engine holds the PID lock → wait, never start a second one.
# Logs: /workspace/desk/logs/engine.log. Orders need kalshi_live=1, kalshi_begin=1, desk_arm=1 and the risk gate.
cd /workspace/desk/MacroMiro || exit 1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
# /usr/local/bin/bun is a sh wrapper that forks the real binary; run the binary directly so signals and exit codes are the engine's.
BUN="$(ls /usr/local/lib/pnpm/5/.pnpm/bun@*/node_modules/bun/bin/bun.exe 2>/dev/null | tail -1)"
[ -x "$BUN" ] || BUN=bun
while true; do
  echo "$(date -Is) supervisor: starting desk engine"
  "$BUN" scripts/desk-engine.ts
  code=$?
  if [ "$code" -eq 3 ]; then
    echo "$(date -Is) supervisor: another engine is running; waiting 30 s"
    sleep 30
  else
    echo "$(date -Is) supervisor: engine exited with $code; restarting in 5 s"
    sleep 5
  fi
done

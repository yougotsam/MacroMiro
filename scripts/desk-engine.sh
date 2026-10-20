#!/bin/bash
# Desk engine supervisor: keeps exactly one `bun scripts/desk-engine.ts` running (the ONLY process that places orders).
# Restarts on crash after 5 s. Exit code 3 = another engine holds the PID lock → wait, never start a second one.
# Logs: /workspace/desk/logs/engine.log. Orders need kalshi_live=1, kalshi_begin=1, desk_arm=1 and the risk gate.
cd /workspace || exit 1
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
# /usr/bin/bun is a 0-byte stub in this environment. Use a real binary or the engine never starts and the watchdog pulse never refreshes, which refuses every order.
pick_bun() {
  local c
  for c in \
    /usr/lib/node_modules/bun/node_modules/@oven/bun-linux-x64/bin/bun \
    /usr/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun
  do
    if [ -x "$c" ] && [ -s "$c" ]; then
      echo "$c"
      return
    fi
  done
  command -v bun
}
BUN="$(pick_bun)"
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

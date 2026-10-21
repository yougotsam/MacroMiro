#!/bin/bash
# Restarts the final-minute book recorder if it exits. Does not send an order.
cd /workspace || exit 1
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
  echo "$(date -Is) book: starting"
  "$BUN" /workspace/scripts/book-recorder.ts
  echo "$(date -Is) book: exited $?; restarting in 5 s"
  sleep 5
done

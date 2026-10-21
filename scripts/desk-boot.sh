#!/bin/bash
# Idempotent boot. Starts the watchdog, waits until its heartbeat is fresh, then starts exactly one desk engine.
# Does not send an order. A failure here must not take the preview down (startup.sh calls this with || true).
set -u
cd /workspace || exit 1
mkdir -p /workspace/desk/logs /workspace/data/loop /workspace/data/desk

if [ -r /workspace/.grok/secrets/tg_token ]; then
  TELEGRAM_BOT_TOKEN="$(cat /workspace/.grok/secrets/tg_token)"
  export TELEGRAM_BOT_TOKEN
fi
if [ -r /workspace/.grok/secrets/tg_chat ]; then
  TELEGRAM_CHAT_ID="$(cat /workspace/.grok/secrets/tg_chat)"
  export TELEGRAM_CHAT_ID
fi

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

proc_matches() {
  local needle="$1"
  local p cmd
  for p in /proc/[0-9]*; do
    cmd=$(tr "\0" " " < "$p/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *"$needle"*) echo "$(basename "$p")"; return 0 ;;
    esac
  done
  return 1
}

if ! proc_matches "scripts/loop/watchdog.ts" >/dev/null; then
  echo "$(date -Is) desk-boot: starting watchdog"
  setsid "$BUN" scripts/loop/watchdog.ts >>/workspace/desk/logs/watchdog.log 2>&1 &
  echo $! >/workspace/data/loop/watchdog.pid
else
  echo "$(date -Is) desk-boot: watchdog already running"
fi

if ! "$BUN" -e '
const fs = require("fs");
const p = process.env.DESK_WATCHDOG_HEARTBEAT || "/workspace/data/loop/watchdog-heartbeat.json";
const deadline = Date.now() + 90_000;
(async () => {
  while (Date.now() < deadline) {
    try {
      const h = JSON.parse(fs.readFileSync(p, "utf8"));
      const t = Date.parse(h.at);
      if (Number.isFinite(t) && Date.now() - t < 180_000 && t <= Date.now() + 5_000) process.exit(0);
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("desk-boot: watchdog heartbeat still stale");
  process.exit(1);
})();
'; then
  echo "$(date -Is) desk-boot: not starting an engine without a fresh watchdog"
  exit 1
fi

if proc_matches "scripts/desk-engine.ts" >/dev/null; then
  echo "$(date -Is) desk-boot: engine already running"
  exit 0
fi

echo "$(date -Is) desk-boot: starting desk engine"
setsid /bin/bash /workspace/scripts/desk-engine.sh >>/workspace/desk/logs/supervisor.log 2>&1 &
echo "$(date -Is) desk-boot: supervisor $!"
exit 0

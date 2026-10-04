#!/bin/sh
set -eu
cd /workspace
if [ -r /tmp/fc.key ]; then
  mkdir -p .grok/secrets
  cp /tmp/fc.key .grok/secrets/fc
  chmod 600 .grok/secrets/fc 2>/dev/null || true
  FIRECRAWL_API_KEY="$(cat /tmp/fc.key)"
  export FIRECRAWL_API_KEY
elif [ -r .grok/secrets/fc ]; then
  FIRECRAWL_API_KEY="$(cat .grok/secrets/fc)"
  export FIRECRAWL_API_KEY
fi
if [ -r .grok/secrets/tg_token ]; then
  TELEGRAM_BOT_TOKEN="$(cat .grok/secrets/tg_token)"
  export TELEGRAM_BOT_TOKEN
fi
if [ -r .grok/secrets/tg_chat ]; then
  TELEGRAM_CHAT_ID="$(cat .grok/secrets/tg_chat)"
  export TELEGRAM_CHAT_ID
fi
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &

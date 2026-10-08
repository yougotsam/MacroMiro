#!/bin/bash
# Display pulse only (read-only). GET /api/live/heart keeps the web scan clock loaded; every ~5 minutes it also
# GETs /api/firecrawl/radar so the news clock stays loaded. It never POSTs and never places orders:
# orders come only from the desk engine (scripts/desk-engine.sh → scripts/desk-engine.ts).
n=0
while true; do
  curl -sS -m 25 http://127.0.0.1:8080/api/live/heart >/tmp/heart-last.json 2>/dev/null || true
  if [ $((n % 20)) -eq 0 ]; then
    curl -sS -m 20 http://127.0.0.1:8080/api/firecrawl/radar >/tmp/radar-last.json 2>/dev/null || true
  fi
  n=$((n + 1))
  sleep 15
done

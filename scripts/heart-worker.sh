#!/bin/bash
# Cloud-side pulse. User laptop can sleep. Hits the live HEART every 15s.
# Every ~5 minutes it also GETs /api/firecrawl/radar. That keeps the news clock loaded in the desk process:
# Spark refreshes at most every 90 minutes, the intel clerks at most every 6 hours (spark.server.ts, run.server.ts).
# News is display and Knock-seed context only. The heart tick never reads it.
n=0
while true; do
  curl -sS -m 25 -X POST http://127.0.0.1:8080/api/live/heart -H 'content-type: application/json' -d '{"tick":true}' >/tmp/heart-last.json || true
  if [ $((n % 20)) -eq 0 ]; then
    curl -sS -m 20 http://127.0.0.1:8080/api/firecrawl/radar >/tmp/radar-last.json 2>/dev/null || true
  fi
  n=$((n + 1))
  sleep 15
done

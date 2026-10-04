#!/bin/bash
# Cloud-side pulse. User laptop can sleep. Hits the live HEART every 15s.
while true; do
  curl -sS -m 25 -X POST http://127.0.0.1:8080/api/live/heart -H 'content-type: application/json' -d '{"tick":true}' >/tmp/heart-last.json || true
  sleep 15
done

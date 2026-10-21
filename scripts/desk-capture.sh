#!/bin/bash
# Restarts the macro capture if it exits. Appends only. Does not send an order and does not truncate the capture file.
cd /workspace || exit 1
while true; do
  echo "$(date -Is) capture: starting"
  python3 /workspace/scripts/macro-event-capture.py
  echo "$(date -Is) capture: exited $?; restarting in 5 s"
  sleep 5
done

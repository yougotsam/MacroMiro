#!/usr/bin/env python3
"""Record-only. Does not import the order path and does not send.

Marks seconds around a high-impact release so a later test can score book lag.
The desk's own decisions log and 1-second prints stay the book and the index.
This file only writes data/desk/macro-capture.jsonl.
"""
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/workspace")
CAL = ROOT / "data" / "macro-calendar.json"
OUT = ROOT / "data" / "desk" / "macro-capture.jsonl"
BLS = "https://www.bls.gov/schedule/news_release/bls.ics"
MAJOR = ("cpi", "consumer price", "fomc", "federal reserve rate", "fed funds", "federal funds", "nonfarm", "non-farm", "nfp", "employment situation", "ppi", "producer price")

def major(name: str) -> bool:
    n = name.lower()
    return any(k in n for k in MAJOR)

def load_events():
    try:
        cal = json.loads(CAL.read_text())
    except Exception as e:
        return [], f"calendar unreadable: {e}"
    return cal.get("events") or [], None

def bls_status():
    try:
        req = urllib.request.Request(BLS, headers={"User-Agent": "MacroMiro-capture/1"})
        with urllib.request.urlopen(req, timeout=20) as res:
            body = res.read(200_000)
            return res.status, len(body)
    except Exception as e:
        return 0, str(e)[:160]

def write(row):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a") as f:
        f.write(json.dumps(row) + "\n")

def main():
    events, err = load_events()
    status, detail = bls_status()
    upcoming = []
    now = datetime.now(timezone.utc)
    for e in events:
        if not major(str(e.get("name") or "")):
            continue
        when = str(e.get("when") or "")
        try:
            at = datetime.fromisoformat(when.replace("Z", "+00:00"))
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if at >= now:
            upcoming.append({"when": e.get("when"), "name": e.get("name"), "agency": e.get("agency")})
    upcoming.sort(key=lambda r: r["when"])
    write({
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": "status",
        "orders": "none",
        "calendar_error": err,
        "bls_http": status,
        "bls_detail": detail,
        "upcoming_major": upcoming[:12],
    })
    while True:
        now = time.time()
        events, _ = load_events()
        hot = []
        for e in events:
            name = str(e.get("name") or "")
            when = str(e.get("when") or "")
            if not major(name) or "T" not in when:
                continue
            try:
                at = datetime.fromisoformat(when.replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
            if at - 1800 <= now <= at + 900:
                hot.append(name)
        if hot:
            write({"ts": datetime.now(timezone.utc).isoformat(), "kind": "window", "events": hot, "orders": "none"})
        time.sleep(60)

if __name__ == "__main__":
    main()

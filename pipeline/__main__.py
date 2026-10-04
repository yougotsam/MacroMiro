from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from pipeline.books import load_book
from pipeline.engine import Pipeline
from pipeline.firecrawl_client import FirecrawlSensor
from pipeline.models import to_dict
from pipeline.paper import PaperBroker
from pipeline.replay import REPLAY_PRICES, replay_gold_eia
from pipeline.store import JsonStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline", description="Printgate event pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_replay = sub.add_parser("replay", help="run the gold EIA fixture through paper rails")
    p_replay.add_argument("--store", default="")

    p_live = sub.add_parser("live", help="Spark-extract one series (needs FIRECRAWL_API_KEY)")
    p_live.add_argument("--book", default="gold")
    p_live.add_argument("--series", required=True)
    p_live.add_argument("--consensus", type=float, required=True)
    p_live.add_argument("--store", default="pipeline/data/store.json")

    p_mon = sub.add_parser("install-monitors", help="create Firecrawl /monitor jobs for a book")
    p_mon.add_argument("--book", default="gold")
    p_mon.add_argument("--webhook", default="")

    p_hook = sub.add_parser("webhook", help="listen for monitor.page events")
    p_hook.add_argument("--book", default="gold")
    p_hook.add_argument("--port", type=int, default=8787)
    p_hook.add_argument("--store", default="pipeline/data/store.json")

    p_watch = sub.add_parser("install-watchlist", help="create Firecrawl monitors for NFP/FOMC/EIA/COT/GLD/BTC")
    p_watch.add_argument("--webhook", default="")

    args = parser.parse_args(argv)

    if args.cmd == "replay":
        store = args.store or str(Path(tempfile.mkdtemp()) / "store.json")
        result = replay_gold_eia(store)
        json.dump(result.to_dict(), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0 if result.fill else 2

    if args.cmd == "live":
        book = load_book(args.book)
        store = JsonStore(args.store)
        store.set_consensus(args.series, args.consensus)
        pipe = Pipeline(
            book,
            store,
            sensor=FirecrawlSensor(),
            price=lambda inst: REPLAY_PRICES.get(inst),
            broker=PaperBroker(),
        )
        result = pipe.ingest_live(args.series)
        json.dump(result.to_dict(), sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0 if result.error is None else 1

    if args.cmd == "install-monitors":
        book = load_book(args.book)
        sensor = FirecrawlSensor()
        pipe = Pipeline(book, JsonStore(tempfile.mkstemp(suffix=".json")[1]), sensor=sensor)
        created = pipe.install_monitors(webhook_url=args.webhook or None)
        json.dump([_safe(c) for c in created], sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0

    if args.cmd == "install-watchlist":
        book = load_book("gold")
        sensor = FirecrawlSensor()
        pipe = Pipeline(book, JsonStore(tempfile.mkstemp(suffix=".json")[1]), sensor=sensor)
        created = pipe.install_watchlist(webhook_url=args.webhook or None)
        json.dump([_safe(c) for c in created], sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0

    if args.cmd == "webhook":
        from pipeline.webhook import serve

        book = load_book(args.book)
        pipe = Pipeline(
            book,
            JsonStore(args.store),
            price=lambda inst: REPLAY_PRICES.get(inst),
        )
        secret = os.getenv("FIRECRAWL_WEBHOOK_SECRET", "")
        serve(pipe, port=args.port, secret=secret)
        return 0

    return 1


def _safe(obj: object) -> object:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()  # type: ignore[no-any-return]
    return to_dict(obj) if hasattr(obj, "__dataclass_fields__") else obj


if __name__ == "__main__":
    raise SystemExit(main())

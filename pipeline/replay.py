from __future__ import annotations

from pathlib import Path
from typing import Any

from pipeline.books import load_book
from pipeline.engine import Pipeline, PipelineResult
from pipeline.models import Print
from pipeline.paper import PaperBroker
from pipeline.store import JsonStore

FIXTURES = Path(__file__).parent / "fixtures"

# Replay prices so notional rails have a number. Not a live feed.
REPLAY_PRICES = {
    "CL": 78.40,
    "GC": 2485.0,
    "BTCUSD": 64_200.0,
}


def replay_gold_eia(store_path: str | Path) -> PipelineResult:
    book = load_book("gold")
    store = JsonStore(store_path)
    store.set_consensus("eia_crude_stocks", 425.1)
    broker = PaperBroker()
    pipe = Pipeline(
        book,
        store,
        price=lambda inst: REPLAY_PRICES.get(inst),
        broker=broker,
    )
    prints = [
        Print(
            series_id="eia_crude_stocks",
            print_value=432.8,
            unit="mmbbl",
            period="week-ending-2026-08-28",
            source_url="https://www.eia.gov/petroleum/supply/weekly/",
            source_title="Weekly Petroleum Status Report",
            passage="U.S. commercial crude oil inventories … 432.8 million barrels",
            confidence="high",
        ),
        Print(
            series_id="eia_crude_stocks",
            print_value=432.8,
            unit="mmbbl",
            period="week-ending-2026-08-28",
            source_url="https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
            source_title="EIA crude stocks table",
            passage="432.8 million barrels",
            confidence="high",
        ),
    ]
    return pipe.ingest_prints("eia_crude_stocks", prints)


def replay_block_no_consensus(store_path: str | Path) -> PipelineResult:
    book = load_book("gold")
    store = JsonStore(store_path)
    pipe = Pipeline(
        book,
        store,
        price=lambda inst: REPLAY_PRICES.get(inst),
        broker=PaperBroker(),
    )
    prints = [
        Print(
            series_id="gld_holdings",
            print_value=910.4,
            source_url="https://www.spdrgoldshares.com/usa/",
            confidence="high",
        ),
        Print(
            series_id="gld_holdings",
            print_value=910.4,
            source_url="https://www.spdrgoldshares.com/usa/gold-bar-list/",
            confidence="high",
        ),
    ]
    return pipe.ingest_prints("gld_holdings", prints)


def replay_from_dict(book_id: str, payload: dict[str, Any], store_path: str | Path) -> PipelineResult:
    book = load_book(book_id)
    store = JsonStore(store_path)
    series_id = payload["series_id"]
    if "consensus" in payload:
        store.set_consensus(series_id, float(payload["consensus"]))
    broker = PaperBroker()
    pipe = Pipeline(
        book,
        store,
        price=lambda inst: float(payload["price"]) if payload.get("price") else REPLAY_PRICES.get(inst),
        broker=broker,
    )
    prints = [Print.from_extract(row) for row in payload["prints"]]
    return pipe.ingest_prints(series_id, prints)

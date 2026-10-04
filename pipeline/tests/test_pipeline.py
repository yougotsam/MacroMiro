from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.books import load_book
from pipeline.engine import Pipeline
from pipeline.models import Print, Side, Verdict
from pipeline.paper import PaperBroker
from pipeline.replay import REPLAY_PRICES, replay_block_no_consensus, replay_gold_eia
from pipeline.store import JsonStore


def _pipe(tmp: str, book_id: str = "gold") -> Pipeline:
    return Pipeline(
        load_book(book_id),
        JsonStore(tmp),
        price=lambda inst: REPLAY_PRICES.get(inst),
        broker=PaperBroker(),
    )


class PipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = str(Path(tempfile.mkdtemp()) / "store.json")

    def test_replay_eia_build_arms_short_paper(self) -> None:
        result = replay_gold_eia(self.tmp)
        self.assertIsNone(result.error)
        self.assertEqual(result.decision.verdict, Verdict.ARM)
        self.assertEqual(result.decision.side, Side.SHORT)
        self.assertIsNotNone(result.fill)
        assert result.fill is not None
        self.assertEqual(result.fill.instrument, "CL")
        self.assertGreater(result.fill.notional, 0)

    def test_no_consensus_blocks(self) -> None:
        result = replay_block_no_consensus(self.tmp)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIsNone(result.fill)
        self.assertIn("consensus", result.decision.reason)

    def test_small_surprise_blocks(self) -> None:
        store = JsonStore(self.tmp)
        store.set_consensus("eia_crude_stocks", 425.1)
        pipe = _pipe(self.tmp)
        prints = [
            Print(
                series_id="eia_crude_stocks",
                print_value=425.2,
                source_url="https://www.eia.gov/petroleum/supply/weekly/",
                confidence="high",
            ),
            Print(
                series_id="eia_crude_stocks",
                print_value=425.2,
                source_url="https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
                confidence="high",
            ),
        ]
        result = pipe.ingest_prints("eia_crude_stocks", prints)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIn("below", result.decision.reason)

    def test_single_source_blocks(self) -> None:
        store = JsonStore(self.tmp)
        store.set_consensus("eia_crude_stocks", 425.1)
        pipe = _pipe(self.tmp)
        prints = [
            Print(
                series_id="eia_crude_stocks",
                print_value=440.0,
                source_url="https://www.eia.gov/petroleum/supply/weekly/",
                confidence="high",
            )
        ]
        result = pipe.ingest_prints("eia_crude_stocks", prints)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIn("2 sources", result.decision.reason)

    def test_disagreeing_sources_block(self) -> None:
        store = JsonStore(self.tmp)
        store.set_consensus("eia_crude_stocks", 425.1)
        pipe = _pipe(self.tmp)
        prints = [
            Print(
                series_id="eia_crude_stocks",
                print_value=440.0,
                source_url="https://www.eia.gov/petroleum/supply/weekly/",
                confidence="high",
            ),
            Print(
                series_id="eia_crude_stocks",
                print_value=410.0,
                source_url="https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
                confidence="high",
            ),
        ]
        result = pipe.ingest_prints("eia_crude_stocks", prints)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIn("disagree", result.decision.reason)

    def test_daily_loss_rail(self) -> None:
        store = JsonStore(self.tmp)
        store.set_consensus("eia_crude_stocks", 425.1)
        broker = PaperBroker()
        broker.day_pnl = -400.0
        pipe = Pipeline(
            load_book("gold"),
            store,
            price=lambda inst: REPLAY_PRICES.get(inst),
            broker=broker,
        )
        prints = [
            Print(
                series_id="eia_crude_stocks",
                print_value=440.0,
                source_url="https://a.example/eia",
                confidence="high",
            ),
            Print(
                series_id="eia_crude_stocks",
                print_value=440.0,
                source_url="https://b.example/eia",
                confidence="high",
            ),
        ]
        result = pipe.ingest_prints("eia_crude_stocks", prints)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIn("daily loss", result.decision.reason)

    def test_cot_has_no_side_map(self) -> None:
        store = JsonStore(self.tmp)
        store.set_consensus("cftc_gold_mm_net", 100_000)
        pipe = _pipe(self.tmp)
        prints = [
            Print(
                series_id="cftc_gold_mm_net",
                print_value=180_000,
                source_url="https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
                confidence="high",
            ),
            Print(
                series_id="cftc_gold_mm_net",
                print_value=180_000,
                source_url="https://www.cftc.gov/dea/futures/deacmesf.htm",
                confidence="high",
            ),
        ]
        result = pipe.ingest_prints("cftc_gold_mm_net", prints)
        self.assertEqual(result.decision.verdict, Verdict.BLOCK)
        self.assertIn("side map", result.decision.reason)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pipeline.analogs import lookup, sign_from_surprise
from pipeline.replay import replay_gold_eia


class AnalogTests(unittest.TestCase):
    def test_eia_build_is_above_and_maps_cl_down(self) -> None:
        row = lookup("eia_crude", "above", "CL")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row.outcome, "down")
        self.assertEqual(row.source, "prior")
        self.assertEqual(row.n, 0)
        self.assertGreaterEqual(row.used_p, 0.55)

    def test_sign_band(self) -> None:
        self.assertEqual(sign_from_surprise(0.05), "inline")
        self.assertEqual(sign_from_surprise(1.8), "above")
        self.assertEqual(sign_from_surprise(-2.0), "below")

    def test_replay_attaches_if_then(self) -> None:
        tmp = str(Path(tempfile.mkdtemp()) / "store.json")
        result = replay_gold_eia(tmp)
        self.assertIsNotNone(result.analog)
        assert result.analog is not None
        self.assertIn("IF eia_crude above", result.analog["rule"])
        self.assertEqual(result.analog["outcome"], "down")
        self.assertEqual(result.decision.verdict.value, "arm")


if __name__ == "__main__":
    unittest.main()

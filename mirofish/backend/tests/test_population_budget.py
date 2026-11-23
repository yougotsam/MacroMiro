import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "population_budget", Path(__file__).parents[1] / "app/services/population_budget.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PopulationBudgetTests(unittest.TestCase):
    def test_population_growth_after_preflight_is_refused(self):
        module.enforce_population_cap(12, 12)
        with self.assertRaisesRegex(ValueError, "exceeds"):
            module.enforce_population_cap(13, 12)

    def test_invalid_caps_cannot_be_interpreted_as_unlimited(self):
        for cap in [0, -1, True, "12", 1.5]:
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                module.enforce_population_cap(12, cap)

    def test_unknown_population_is_refused(self):
        for count in [None, True, "12", -1]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                module.enforce_population_cap(count, 12)

    def test_existing_callers_without_cap_remain_compatible(self):
        module.enforce_population_cap(12, None)


if __name__ == "__main__":
    unittest.main()

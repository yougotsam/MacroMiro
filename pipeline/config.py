from __future__ import annotations

from dataclasses import dataclass, field

from pipeline.models import Side


@dataclass
class RailsConfig:
    max_notional_usd: float = 10_000.0
    max_daily_loss_usd: float = 500.0
    max_open_positions: int = 1
    require_two_sources: bool = True
    require_consensus: bool = True
    min_abs_surprise_pct: float = 0.5
    min_extract_confidence: frozenset[str] = field(
        default_factory=lambda: frozenset({"high", "medium"})
    )
    paper_only: bool = True
    min_analog_p: float = 0.55


@dataclass
class Series:
    id: str
    name: str
    instrument: str
    unit: str
    urls: list[str]
    monitor_goal: str
    schedule: str = "every 6 hours"
    # Your mapping. None = never auto-arm this series.
    side_if_print_above: Side | None = None
    qty: float = 1.0
    min_abs_surprise_pct: float | None = None
    event_class: str = ""


@dataclass
class Book:
    id: str
    name: str
    rails: RailsConfig
    series: list[Series]
    spark_effort: str = "high"
    spark_max_credits: int = 800
    spark_model: str = "spark-2"

    def get(self, series_id: str) -> Series:
        for s in self.series:
            if s.id == series_id:
                return s
        raise KeyError(series_id)

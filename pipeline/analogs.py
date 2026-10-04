from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Sign = Literal["above", "below", "inline"]
Horizon = Literal["session", "1d"]


@dataclass
class AnalogRow:
    event_class: str
    surprise_sign: Sign
    asset: str
    horizon: Horizon
    outcome: Literal["up", "down"]
    # Your stated prior. Not a backtest. Edit it.
    prior_p: float
    n: int = 0
    hits: int = 0

    @property
    def empirical_p(self) -> float | None:
        if self.n < 1:
            return None
        return self.hits / self.n

    @property
    def used_p(self) -> float:
        # Empirical only once you have a real sample.
        if self.n >= 20 and self.empirical_p is not None:
            return self.empirical_p
        return self.prior_p

    @property
    def source(self) -> str:
        return "empirical" if self.n >= 20 else "prior"


# Directional priors YOU own. Round numbers on purpose — not fake precision.
# Outcome = typical session direction of the asset if the print is a surprise.
PRIORS: tuple[AnalogRow, ...] = (
    AnalogRow("nfp", "above", "GC", "session", "down", prior_p=0.58),
    AnalogRow("nfp", "above", "DXY", "session", "up", prior_p=0.60),
    AnalogRow("nfp", "below", "GC", "session", "up", prior_p=0.56),
    AnalogRow("cpi", "above", "GC", "session", "down", prior_p=0.55),
    AnalogRow("cpi", "below", "GC", "session", "up", prior_p=0.55),
    AnalogRow("fomc", "above", "GC", "session", "down", prior_p=0.57),  # hawkish vs priced
    AnalogRow("fomc", "below", "GC", "session", "up", prior_p=0.57),
    AnalogRow("eia_crude", "above", "CL", "session", "down", prior_p=0.62),
    AnalogRow("eia_crude", "below", "CL", "session", "up", prior_p=0.62),
    AnalogRow("gld_flow", "above", "GC", "1d", "up", prior_p=0.54),
    AnalogRow("btc_etf_flow", "above", "BTCUSD", "session", "up", prior_p=0.55),
    AnalogRow("btc_etf_flow", "below", "BTCUSD", "session", "down", prior_p=0.55),
)


def lookup(event_class: str, surprise_sign: Sign, asset: str) -> AnalogRow | None:
    for row in PRIORS:
        if (
            row.event_class == event_class
            and row.surprise_sign == surprise_sign
            and row.asset == asset
        ):
            return row
    return None


def sign_from_surprise(pct: float, inline_band: float = 0.15) -> Sign:
    if abs(pct) < inline_band:
        return "inline"
    return "above" if pct > 0 else "below"


def apply_counts(row: AnalogRow, n: int, hits: int) -> AnalogRow:
    return AnalogRow(
        event_class=row.event_class,
        surprise_sign=row.surprise_sign,
        asset=row.asset,
        horizon=row.horizon,
        outcome=row.outcome,
        prior_p=row.prior_p,
        n=n,
        hits=hits,
    )

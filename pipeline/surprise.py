from __future__ import annotations

from pipeline.models import Print, Surprise


class NoConsensus(Exception):
    """Fail closed: no stored street number, no trade."""


def compute_surprise(print_: Print, consensus: float | None) -> Surprise:
    if consensus is None:
        raise NoConsensus(f"no consensus stored for {print_.series_id}")
    delta = print_.print_value - float(consensus)
    if consensus == 0:
        pct = 100.0 if delta != 0 else 0.0
    else:
        pct = (delta / abs(float(consensus))) * 100.0
    if delta > 0:
        sign = 1
    elif delta < 0:
        sign = -1
    else:
        sign = 0
    return Surprise(
        series_id=print_.series_id,
        print_value=print_.print_value,
        consensus=float(consensus),
        abs_delta=abs(delta),
        pct=pct,
        sign=sign,
    )

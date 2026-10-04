from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pipeline.models import Decision, PaperFill, Side, Verdict


class PaperBroker:
    def __init__(self) -> None:
        self.fills: list[PaperFill] = []
        self.open: list[PaperFill] = []
        self.day_pnl: float = 0.0

    @property
    def open_count(self) -> int:
        return len(self.open)

    def submit(
        self,
        decision: Decision,
        *,
        instrument: str,
        price: float,
        series_id: str,
    ) -> PaperFill | None:
        if decision.verdict is not Verdict.ARM or decision.side is None:
            return None
        now = datetime.now(timezone.utc).isoformat()
        fill = PaperFill(
            id=uuid.uuid4().hex[:12],
            series_id=series_id,
            instrument=instrument,
            side=decision.side,
            qty=decision.qty,
            price=price,
            notional=abs(decision.qty * price),
            reason=decision.reason,
            print_value=decision.surprise.print_value if decision.surprise else 0.0,
            consensus=decision.surprise.consensus if decision.surprise else 0.0,
            surprise_pct=decision.surprise.pct if decision.surprise else 0.0,
            sources=list(decision.sources),
            ts=now,
        )
        self.fills.append(fill)
        self.open.append(fill)
        return fill

    def flatten(self, fill_id: str, exit_price: float) -> float:
        match = next((f for f in self.open if f.id == fill_id), None)
        if match is None:
            raise KeyError(fill_id)
        signed = match.qty if match.side is Side.LONG else -match.qty
        pnl = signed * (exit_price - match.price)
        self.day_pnl += pnl
        self.open = [f for f in self.open if f.id != fill_id]
        return pnl

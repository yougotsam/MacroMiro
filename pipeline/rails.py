from __future__ import annotations

from pipeline.config import Book, RailsConfig, Series
from pipeline.models import Decision, Print, Verdict


class Rails:
    def __init__(self, config: RailsConfig) -> None:
        self.config = config

    def check(
        self,
        book: Book,
        series: Series,
        prints: list[Print],
        decision: Decision,
        *,
        open_positions: int,
        day_pnl: float,
        last_price: float | None,
        analog_p: float | None = None,
        analog_source: str | None = None,
    ) -> Decision:
        log: list[str] = list(decision.rails_log)

        if not self.config.paper_only:
            decision.verdict = Verdict.BLOCK
            decision.reason = "live execution is disabled in this build"
            log.append("paper_only")
            decision.rails_log = log
            return decision

        if decision.verdict is Verdict.BLOCK:
            decision.rails_log = log
            return decision

        if self.config.require_consensus and decision.surprise is None:
            return _block(decision, log, "missing surprise")

        if self.config.require_two_sources:
            uniq = {p.source_url.rstrip("/") for p in prints}
            if len(uniq) < 2:
                return _block(decision, log, f"need 2 sources, got {len(uniq)}")
            if not _prints_agree(prints):
                return _block(decision, log, "sources disagree on print_value")

        allowed = self.config.min_extract_confidence
        for p in prints:
            if p.confidence not in allowed:
                return _block(decision, log, f"confidence {p.confidence} rejected")

        if open_positions >= self.config.max_open_positions:
            return _block(decision, log, "max open positions")

        if day_pnl <= -abs(self.config.max_daily_loss_usd):
            return _block(decision, log, "daily loss rail")

        if analog_p is not None and analog_p < self.config.min_analog_p:
            return _block(
                decision,
                log,
                f"analog p {analog_p:.2f} ({analog_source}) below {self.config.min_analog_p:.2f}",
            )

        if last_price is None or last_price <= 0:
            return _block(decision, log, "no price for notional check")

        notional = abs(decision.qty * last_price)
        if notional > self.config.max_notional_usd:
            return _block(
                decision, log, f"notional {notional:.0f} > max {self.config.max_notional_usd:.0f}"
            )

        log.append("rails_clear")
        decision.rails_log = log
        return decision


def _prints_agree(prints: list[Print], rel_tol: float = 0.002) -> bool:
    if len(prints) < 2:
        return False
    base = prints[0].print_value
    if base == 0:
        return all(abs(p.print_value) < 1e-9 for p in prints)
    return all(abs(p.print_value - base) / abs(base) <= rel_tol for p in prints)


def _block(decision: Decision, log: list[str], reason: str) -> Decision:
    log.append(reason)
    decision.verdict = Verdict.BLOCK
    decision.reason = reason
    decision.side = None
    decision.qty = 0.0
    decision.rails_log = log
    return decision

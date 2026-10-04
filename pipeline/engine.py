from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from pipeline.config import Book
from pipeline.firecrawl_client import FirecrawlSensor
from pipeline.models import Decision, PaperFill, Print, Surprise, Verdict, to_dict
from pipeline.paper import PaperBroker
from pipeline.rails import Rails
from pipeline.store import JsonStore
from pipeline.strategy import SurpriseMapStrategy
from pipeline.surprise import NoConsensus, compute_surprise
from pipeline.analogs import lookup, sign_from_surprise

PriceFn = Callable[[str], float | None]


@dataclass
class PipelineResult:
    prints: list[Print]
    surprise: Surprise | None
    decision: Decision
    fill: PaperFill | None
    analog: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "prints": [to_dict(p) for p in self.prints],
            "surprise": to_dict(self.surprise) if self.surprise else None,
            "decision": to_dict(self.decision),
            "fill": to_dict(self.fill) if self.fill else None,
            "analog": self.analog,
            "error": self.error,
        }


class Pipeline:
    def __init__(
        self,
        book: Book,
        store: JsonStore,
        *,
        sensor: FirecrawlSensor | None = None,
        price: PriceFn | None = None,
        broker: PaperBroker | None = None,
    ) -> None:
        self.book = book
        self.store = store
        self.sensor = sensor or FirecrawlSensor()
        self.price = price or (lambda _instrument: None)
        self.broker = broker or PaperBroker()
        self.strategy = SurpriseMapStrategy()
        self.rails = Rails(book.rails)

    def ingest_prints(
        self,
        series_id: str,
        prints: list[Print],
        *,
        consensus: float | None = None,
    ) -> PipelineResult:
        series = self.book.get(series_id)
        if consensus is None:
            consensus = self.store.get_consensus(series_id)

        empty = Decision(verdict=Verdict.BLOCK, reason="no prints", sources=[])
        if not prints:
            return PipelineResult([], None, empty, None, error="no prints")

        try:
            surprise = compute_surprise(prints[0], consensus)
        except NoConsensus as exc:
            blocked = Decision(
                verdict=Verdict.BLOCK,
                reason=str(exc),
                sources=[p.source_url for p in prints],
            )
            return PipelineResult(prints, None, blocked, None, error=str(exc))

        decision = self.strategy.decide(self.book, series, prints, surprise)
        last_price = self.price(series.instrument)
        analog_info = None
        analog_p = None
        analog_source = None
        if series.event_class:
            sign = sign_from_surprise(surprise.pct)
            row = lookup(series.event_class, sign, series.instrument)
            if row is None and series.instrument == "CL":
                row = lookup(series.event_class, sign, "CL")
            if row is not None:
                analog_info = {
                    "event_class": row.event_class,
                    "sign": row.surprise_sign,
                    "asset": row.asset,
                    "outcome": row.outcome,
                    "prior_p": row.prior_p,
                    "used_p": row.used_p,
                    "source": row.source,
                    "n": row.n,
                    "horizon": row.horizon,
                    "rule": f"IF {row.event_class} {row.surprise_sign} consensus → {row.asset} {row.outcome} ({row.horizon})",
                }
                analog_p = row.used_p
                analog_source = row.source
        decision = self.rails.check(
            self.book,
            series,
            prints,
            decision,
            open_positions=self.broker.open_count,
            day_pnl=self.broker.day_pnl,
            last_price=last_price,
            analog_p=analog_p,
            analog_source=analog_source,
        )

        fill = None
        if decision.verdict is Verdict.ARM and last_price is not None:
            fill = self.broker.submit(
                decision,
                instrument=series.instrument,
                price=last_price,
                series_id=series.id,
            )
            self.store.record_print(series_id, prints[0].print_value)

        self.store.append_event(
            {
                "series_id": series_id,
                "verdict": decision.verdict.value,
                "reason": decision.reason,
                "fill_id": fill.id if fill else None,
            }
        )
        return PipelineResult(prints, surprise, decision, fill, analog=analog_info)

    def ingest_live(self, series_id: str) -> PipelineResult:
        series = self.book.get(series_id)
        raw = self.sensor.spark_print(
            series.urls,
            series.id,
            series.monitor_goal,
            model=self.book.spark_model,
            effort=self.book.spark_effort,
            max_credits=self.book.spark_max_credits,
        )
        # Second pass: scrape each URL independently so rails can demand agreement.
        scraped: list[dict[str, Any]] = []
        for url in series.urls:
            try:
                scraped.append(self.sensor.scrape_print(url, series.id, series.monitor_goal))
            except Exception as exc:  # noqa: BLE001 — fail closed per URL
                scraped.append(
                    {
                        "series_id": series.id,
                        "print_value": None,
                        "source_url": url,
                        "notes": f"scrape_failed:{exc}",
                        "confidence": "low",
                    }
                )

        prints: list[Print] = []
        errors: list[str] = []
        for payload in [raw, *scraped]:
            try:
                prints.append(Print.from_extract(payload))
            except (TypeError, ValueError) as exc:
                errors.append(str(exc))

        # Dedup by URL, keep first valid
        uniq: dict[str, Print] = {}
        for p in prints:
            uniq.setdefault(p.source_url.rstrip("/"), p)
        prints = list(uniq.values())
        if not prints:
            blocked = Decision(
                verdict=Verdict.BLOCK,
                reason="extract failed",
                sources=[],
            )
            return PipelineResult([], None, blocked, None, error="; ".join(errors) or "extract failed")
        return self.ingest_prints(series_id, prints)

    def install_monitors(self, webhook_url: str | None = None) -> list[Any]:
        out = []
        for series in self.book.series:
            out.append(
                self.sensor.install_monitor(
                    name=f"printgate:{self.book.id}:{series.id}",
                    schedule=series.schedule,
                    urls=series.urls,
                    goal=series.monitor_goal,
                    webhook_url=webhook_url,
                )
            )
        return out

    def install_watchlist(self, webhook_url: str | None = None) -> list[Any]:
        from pipeline.watchlist import WATCH, monitor_payload

        out = []
        for target in WATCH:
            payload = monitor_payload(target, webhook_url)
            out.append(self.sensor.create_monitor_raw(payload))
        return out

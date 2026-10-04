from __future__ import annotations

import os
from typing import Any

from pipeline.models import PRINT_SCHEMA

EXTRACT_PROMPT = (
    "Extract only the numeric print described in the series goal. "
    "Return JSON matching the schema. If the number is not on the page, "
    "set print_value to null. Never guess. Include the exact passage."
)


class FirecrawlSensor:
    """Thin wrapper around Firecrawl v2: scrape JSON, Spark-2 agent, monitors."""

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.getenv("FIRECRAWL_API_KEY")
        self._client = None

    @property
    def live(self) -> bool:
        return bool(self.api_key)

    def client(self):
        if not self.live:
            raise RuntimeError(
                "FIRECRAWL_API_KEY is not set. Replay does not need it. "
                "Live extract/monitor does."
            )
        if self._client is None:
            from firecrawl import Firecrawl

            self._client = Firecrawl(api_key=self.api_key)
        return self._client

    def scrape_print(self, url: str, series_id: str, goal: str) -> dict[str, Any]:
        doc = self.client().scrape(
            url,
            formats=[
                "markdown",
                {
                    "type": "json",
                    "prompt": f"{EXTRACT_PROMPT}\nSeries: {series_id}\nGoal: {goal}",
                    "schema": PRINT_SCHEMA,
                },
            ],
            only_main_content=True,
            timeout=90_000,
        )
        payload = _json_from_doc(doc)
        payload.setdefault("series_id", series_id)
        payload.setdefault("source_url", url)
        return payload

    def spark_print(
        self,
        urls: list[str],
        series_id: str,
        goal: str,
        *,
        model: str = "spark-2",
        effort: str = "high",
        max_credits: int = 800,
    ) -> dict[str, Any]:
        prompt = (
            f"Series id: {series_id}\n"
            f"Goal: {goal}\n"
            f"{EXTRACT_PROMPT}\n"
            "Visit every provided URL. If sources disagree, pick the official "
            "first-party figure and put the conflict in notes. "
            "Do not produce adjectives. Do not say bullish or bearish."
        )
        result = self.client().agent(
            urls=urls,
            prompt=prompt,
            schema=PRINT_SCHEMA,
            model=model,  # spark-2
            effort=effort,
            max_credits=max_credits,
            strict_constrain_to_urls=True,
            timeout=180,
        )
        payload = _json_from_agent(result)
        payload.setdefault("series_id", series_id)
        if urls and not payload.get("source_url"):
            payload["source_url"] = urls[0]
        return payload

    def install_monitor(
        self,
        *,
        name: str,
        schedule: str,
        urls: list[str],
        goal: str,
        webhook_url: str | None = None,
    ) -> Any:
        webhook = None
        if webhook_url:
            webhook = {
                "url": webhook_url,
                "events": ["monitor.page", "monitor.check.completed"],
            }
        return self.client().create_monitor(
            name=name,
            schedule={"text": schedule},
            targets=[
                {
                    "type": "scrape",
                    "urls": urls,
                    "scrapeOptions": {
                        "formats": [
                            {
                                "type": "changeTracking",
                                "modes": ["json"],
                                "schema": PRINT_SCHEMA,
                                "prompt": goal,
                            }
                        ]
                    },
                }
            ],
            goal=goal,
            judge_enabled=True,
            webhook=webhook,
        )

    def create_monitor_raw(self, payload: dict[str, Any]) -> Any:
        webhook = payload.get("webhook")
        return self.client().create_monitor(
            name=payload["name"],
            schedule=payload["schedule"],
            targets=payload["targets"],
            goal=payload.get("goal"),
            judge_enabled=payload.get("judge_enabled", True),
            webhook=webhook,
        )

    def search(self, query: str, *, limit: int = 5) -> Any:
        return self.client().search(query, limit=limit)

    def map(self, url: str) -> Any:
        return self.client().map(url)

    def parse(self, url: str) -> Any:
        return self.client().parse(url)

    def agent_research(self, prompt: str, schema: dict[str, Any] | None = None) -> Any:
        return self.client().agent(
            prompt=prompt,
            schema=schema,
            model="spark-2",
            effort="high",
            max_credits=1500,
            timeout=240,
        )


def _json_from_doc(doc: Any) -> dict[str, Any]:
    if isinstance(doc, dict):
        data = doc.get("json") or doc.get("data") or doc
        return dict(data) if isinstance(data, dict) else {}
    data = getattr(doc, "json", None)
    if isinstance(data, dict):
        return dict(data)
    metadata = getattr(doc, "metadata", None)
    if isinstance(metadata, dict) and isinstance(metadata.get("json"), dict):
        return dict(metadata["json"])
    return {}


def _json_from_agent(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        data = result.get("data") or result.get("json") or result
        if isinstance(data, list) and data:
            inner = data[0]
            if isinstance(inner, dict):
                return dict(inner.get("data") or inner)
        if isinstance(data, dict):
            return dict(data.get("data") or data)
        return {}
    data = getattr(result, "data", None)
    if isinstance(data, dict):
        return dict(data)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        row = data[0]
        return dict(row.get("data") or row)
    return {}

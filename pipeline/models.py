from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from enum import Enum
from typing import Any


class Side(str, Enum):
    LONG = "long"
    SHORT = "short"


class Verdict(str, Enum):
    ARM = "arm"
    BLOCK = "block"


def to_dict(obj: Any) -> Any:
    if is_dataclass(obj):
        return {k: to_dict(v) for k, v in asdict(obj).items()}
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, list):
        return [to_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    return obj


PRINT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["print_value", "source_url", "series_id"],
    "properties": {
        "series_id": {"type": "string"},
        "print_value": {"type": ["number", "null"]},
        "unit": {"type": "string"},
        "period": {"type": "string"},
        "source_url": {"type": "string"},
        "source_title": {"type": "string"},
        "published_at": {"type": "string"},
        "passage": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "notes": {"type": "string"},
    },
}


@dataclass
class Print:
    series_id: str
    print_value: float
    source_url: str
    unit: str = ""
    period: str = ""
    source_title: str = ""
    published_at: str = ""
    passage: str = ""
    confidence: str = "medium"
    notes: str = ""

    @classmethod
    def from_extract(cls, data: dict[str, Any]) -> "Print":
        value = data.get("print_value")
        if value is None:
            raise ValueError("extract missing print_value")
        url = str(data.get("source_url") or "").strip()
        if not url:
            raise ValueError("extract missing source_url")
        series = str(data.get("series_id") or "").strip()
        if not series:
            raise ValueError("extract missing series_id")
        return cls(
            series_id=series,
            print_value=float(value),
            source_url=url,
            unit=str(data.get("unit") or ""),
            period=str(data.get("period") or ""),
            source_title=str(data.get("source_title") or ""),
            published_at=str(data.get("published_at") or ""),
            passage=str(data.get("passage") or "")[:800],
            confidence=str(data.get("confidence") or "medium"),
            notes=str(data.get("notes") or ""),
        )


@dataclass
class Surprise:
    series_id: str
    print_value: float
    consensus: float
    abs_delta: float
    pct: float
    sign: int  # +1 print above consensus, -1 below, 0 equal

    @property
    def print_above(self) -> bool:
        return self.sign > 0


@dataclass
class Decision:
    verdict: Verdict
    reason: str
    side: Side | None = None
    qty: float = 0.0
    surprise: Surprise | None = None
    sources: list[str] = field(default_factory=list)
    rails_log: list[str] = field(default_factory=list)


@dataclass
class PaperFill:
    id: str
    series_id: str
    instrument: str
    side: Side
    qty: float
    price: float
    notional: float
    reason: str
    print_value: float
    consensus: float
    surprise_pct: float
    sources: list[str]
    ts: str

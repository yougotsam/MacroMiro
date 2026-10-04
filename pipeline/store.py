from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class JsonStore:
    """Consensus + last prints. Path is local-only — never commit secrets here."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"consensus": {}, "last_print": {}, "events": []})

    def _read(self) -> dict[str, Any]:
        return json.loads(self.path.read_text())

    def _write(self, data: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(data, indent=2, sort_keys=True))

    def get_consensus(self, series_id: str) -> float | None:
        raw = self._read()["consensus"].get(series_id)
        return None if raw is None else float(raw)

    def set_consensus(self, series_id: str, value: float) -> None:
        data = self._read()
        data["consensus"][series_id] = float(value)
        self._write(data)

    def record_print(self, series_id: str, value: float) -> None:
        data = self._read()
        data["last_print"][series_id] = float(value)
        self._write(data)

    def append_event(self, event: dict[str, Any]) -> None:
        data = self._read()
        events = data.setdefault("events", [])
        events.append(event)
        data["events"] = events[-200:]
        self._write(data)

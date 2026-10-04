from __future__ import annotations

import hashlib
import hmac
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable

from pipeline.engine import Pipeline, PipelineResult
from pipeline.models import Print

ProcessFn = Callable[[str, list[Print]], PipelineResult]


def verify_signature(secret: str, body: bytes, header: str | None) -> bool:
    if not secret:
        return True
    if not header:
        return False
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    expected = "sha256=" + digest
    return hmac.compare_digest(expected, header.strip())


def prints_from_monitor_payload(payload: dict[str, Any], series_id: str) -> list[Print]:
    """Pull JSON snapshots out of a monitor.page webhook."""
    rows = payload.get("data") or []
    if isinstance(rows, dict):
        rows = [rows]
    prints: list[Print] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        snapshot = (
            (row.get("snapshot") or {}).get("json")
            if isinstance(row.get("snapshot"), dict)
            else None
        )
        blob = snapshot or row.get("json") or row.get("extracted") or {}
        if not isinstance(blob, dict):
            continue
        blob.setdefault("series_id", series_id)
        blob.setdefault("source_url", row.get("url") or blob.get("source_url"))
        try:
            prints.append(Print.from_extract(blob))
        except (TypeError, ValueError):
            continue
    return prints


class WebhookHandler(BaseHTTPRequestHandler):
    pipeline: Pipeline
    secret: str = ""
    series_hint: str = ""

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        sig = self.headers.get("X-Firecrawl-Signature")
        if not verify_signature(self.secret, body, sig):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"bad signature"}')
            return
        try:
            payload = json.loads(body.decode() or "{}")
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return
        series_id = (
            (payload.get("metadata") or {}).get("series_id")
            or self.series_hint
            or ""
        )
        if not series_id:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"no series_id"}')
            return
        # Meaningful-change gate: ignore noise.
        data = payload.get("data") or []
        if isinstance(data, list) and data and isinstance(data[0], dict):
            if data[0].get("isMeaningful") is False:
                self._json(200, {"ok": True, "skipped": "not meaningful"})
                return
        result = self.pipeline.ingest_live(series_id)
        self._json(200, {"ok": True, "result": result.to_dict()})

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def serve(pipeline: Pipeline, *, host: str = "0.0.0.0", port: int = 8787, secret: str = "") -> None:
    WebhookHandler.pipeline = pipeline
    WebhookHandler.secret = secret
    httpd = HTTPServer((host, port), WebhookHandler)
    httpd.serve_forever()

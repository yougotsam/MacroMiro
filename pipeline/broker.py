from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

from pipeline.models import Decision, PaperFill, Verdict
from pipeline.paper import PaperBroker


@dataclass
class BrokerChoice:
    id: str
    name: str
    role: str
    assets: str
    paper: str
    api: str
    when: str
    blocker: str


# Hands stay paper until a key exists. Do not run two live brokers.
CHOICES: tuple[BrokerChoice, ...] = (
    BrokerChoice(
        id="paper",
        name="Printgate paper",
        role="Default. Same rails, no money.",
        assets="Any instrument the book names (CL, GC, BTCUSD, …)",
        paper="Built-in",
        api="Local ledger",
        when="Now",
        blocker="",
    ),
    BrokerChoice(
        id="alpaca",
        name="Alpaca paper",
        role="Stocks + crypto paper API. Same REST as live.",
        assets="US stocks, ETFs, crypto. No futures. No FX. No COMEX gold.",
        paper="https://paper-api.alpaca.markets",
        api="REST + WebSocket. Official MCP V2.",
        when="When you want GLD / IBIT / BTCUSD fills against a real paper API",
        blocker="Will not trade GC or CL futures. US-centric live.",
    ),
    BrokerChoice(
        id="ibkr",
        name="Interactive Brokers",
        role="The live book for a commodities / FX license.",
        assets="Futures, FX, stocks, options, global. This is gold/CL/FX.",
        paper="IBKR paper account via Client Portal / TWS",
        api="Client Portal REST or TWS socket. Not a one-hour SDK.",
        when="After paper is boring and you actually want GC/CL",
        blocker="Gateway must stay up. Do not start here.",
    ),
)


class Broker(Protocol):
    id: str

    def submit(self, decision: Decision, **kwargs) -> PaperFill | None: ...


class AlpacaPaper:
    """Submits only if ALPACA_API_KEY + ALPACA_API_SECRET are set. Paper host only."""

    id = "alpaca"

    def __init__(self) -> None:
        self.key = os.getenv("ALPACA_API_KEY")
        self.secret = os.getenv("ALPACA_API_SECRET")
        self.base = os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")

    @property
    def live(self) -> bool:
        return bool(self.key and self.secret)

    def submit(self, decision: Decision, **kwargs) -> PaperFill | None:
        if not self.live:
            raise RuntimeError("ALPACA_API_KEY / ALPACA_API_SECRET not set")
        if "api.alpaca.markets" in self.base and "paper" not in self.base:
            raise RuntimeError("refusing live Alpaca host — paper only in this build")
        if decision.verdict is not Verdict.ARM:
            return None
        # Wire alpaca-py here when keys exist. Until then fail closed.
        raise RuntimeError("Alpaca adapter is keyed but order client is not enabled yet")


def default_broker() -> PaperBroker:
    return PaperBroker()

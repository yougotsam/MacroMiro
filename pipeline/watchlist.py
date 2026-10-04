from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from pipeline.models import PRINT_SCHEMA


@dataclass(frozen=True)
class WatchTarget:
    id: str
    name: str
    kind: str  # print | calendar | narrative
    event_class: str
    urls: tuple[str, ...]
    goal: str
    schedule: str
    timezone: str = "America/New_York"


@dataclass(frozen=True)
class CalendarEvent:
    id: str
    name: str
    event_class: str
    when_et: str  # ISO local ET date or datetime
    status: str  # upcoming | watch | past
    source_url: str
    impact: str  # high | medium
    notes: str


# Official pages only. Monitor JSON-diffs these. Spark extracts on webhook.
WATCH: tuple[WatchTarget, ...] = (
    WatchTarget(
        id="bls_nfp",
        name="BLS Employment Situation (NFP)",
        kind="print",
        event_class="nfp",
        urls=(
            "https://www.bls.gov/news.release/empsit.nr0.htm",
            "https://www.bls.gov/news.release/empsit.toc.htm",
        ),
        goal=(
            "Extract the latest nonfarm payroll change in thousands and the "
            "unemployment rate. Do not guess. Passage must contain the number."
        ),
        schedule="every friday at 08:35 America/New_York",
    ),
    WatchTarget(
        id="bls_cpi",
        name="BLS CPI",
        kind="print",
        event_class="cpi",
        urls=(
            "https://www.bls.gov/news.release/cpi.nr0.htm",
            "https://www.bls.gov/cpi/",
        ),
        goal="Extract latest CPI-U all-items 12-month percent change. No guess.",
        schedule="every 6 hours",
    ),
    WatchTarget(
        id="fomc_calendar",
        name="FOMC calendar + statement",
        kind="calendar",
        event_class="fomc",
        urls=(
            "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
            "https://www.federalreserve.gov/monetarypolicy/fomc.htm",
        ),
        goal=(
            "Extract the next FOMC decision date and, if a statement is up, "
            "the federal funds target range. No adjectives."
        ),
        schedule="every 2 hours",
    ),
    WatchTarget(
        id="eia_wpsr",
        name="EIA weekly petroleum",
        kind="print",
        event_class="eia_crude",
        urls=(
            "https://www.eia.gov/petroleum/supply/weekly/",
            "https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
        ),
        goal="Extract U.S. commercial crude inventories in million barrels.",
        schedule="every wednesday at 10:35 America/New_York",
    ),
    WatchTarget(
        id="cftc_cot",
        name="CFTC Commitments of Traders",
        kind="print",
        event_class="cot_gold",
        urls=(
            "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
            "https://www.cftc.gov/dea/futures/deacmesf.htm",
        ),
        goal="Extract COMEX gold managed-money net contracts if present.",
        schedule="every friday at 15:35 America/New_York",
    ),
    WatchTarget(
        id="gld_holdings",
        name="SPDR GLD holdings",
        kind="print",
        event_class="gld_flow",
        urls=(
            "https://www.spdrgoldshares.com/usa/",
            "https://www.spdrgoldshares.com/usa/gold-bar-list/",
        ),
        goal="Extract GLD gold holdings in tonnes.",
        schedule="every 6 hours",
    ),
    WatchTarget(
        id="btc_etf_farside",
        name="US spot BTC ETF flows",
        kind="print",
        event_class="btc_etf_flow",
        urls=(
            "https://farside.co.uk/btc/",
            "https://www.theblock.co/data/crypto-markets/bitcoin-etf",
        ),
        goal="Extract latest daily net US spot bitcoin ETF flow in million USD.",
        schedule="every weekday at 18:00 America/New_York",
    ),
)


# Dates verified against federalreserve.gov FOMC calendar. NFP = first Friday rule.
CALENDAR: tuple[CalendarEvent, ...] = (
    CalendarEvent(
        id="fomc-2026-09-16",
        name="FOMC decision + SEP",
        event_class="fomc",
        when_et="2026-09-16T14:00:00",
        status="upcoming",
        source_url="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        impact="high",
        notes="Two-day meeting Sep 15–16. Statement 2:00pm ET. Presser 2:30pm.",
    ),
    CalendarEvent(
        id="eia-weekly",
        name="EIA Weekly Petroleum Status",
        event_class="eia_crude",
        when_et="wednesday 10:30",
        status="watch",
        source_url="https://www.eia.gov/petroleum/supply/weekly/",
        impact="high",
        notes="Every Wednesday 10:30am ET. Surprise vs stored consensus, not the headline.",
    ),
    CalendarEvent(
        id="cot-weekly",
        name="CFTC COT",
        event_class="cot_gold",
        when_et="friday 15:30",
        status="watch",
        source_url="https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
        impact="medium",
        notes="Friday 3:30pm ET. Positions as of prior Tuesday.",
    ),
    CalendarEvent(
        id="nfp-2026-10-02",
        name="BLS Employment Situation",
        event_class="nfp",
        when_et="2026-10-02T08:30:00",
        status="upcoming",
        source_url="https://www.bls.gov/news.release/empsit.nr0.htm",
        impact="high",
        notes="First Friday rule for October 2026. Confirm on BLS release calendar.",
    ),
    CalendarEvent(
        id="fomc-2026-10-28",
        name="FOMC decision",
        event_class="fomc",
        when_et="2026-10-28T14:00:00",
        status="upcoming",
        source_url="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        impact="high",
        notes="Oct 27–28 meeting. No SEP.",
    ),
    CalendarEvent(
        id="fomc-2026-12-09",
        name="FOMC decision + SEP",
        event_class="fomc",
        when_et="2026-12-09T14:00:00",
        status="upcoming",
        source_url="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        impact="high",
        notes="Dec 8–9. SEP / dot plot.",
    ),
)


def monitor_payload(target: WatchTarget, webhook_url: str | None) -> dict:
    webhook = None
    if webhook_url:
        webhook = {
            "url": webhook_url,
            "events": ["monitor.page", "monitor.check.completed"],
            "metadata": {"watch_id": target.id, "event_class": target.event_class},
        }
    return {
        "name": f"printgate:{target.id}",
        "schedule": {"text": target.schedule, "timezone": target.timezone},
        "goal": target.goal,
        "judge_enabled": True,
        "targets": [
            {
                "type": "scrape",
                "urls": list(target.urls),
                "scrapeOptions": {
                    "formats": [
                        {
                            "type": "changeTracking",
                            "modes": ["json"],
                            "schema": PRINT_SCHEMA,
                            "prompt": target.goal,
                        }
                    ]
                },
            }
        ],
        "webhook": webhook,
    }


def upcoming(today: date | None = None) -> list[CalendarEvent]:
    today = today or datetime.now(timezone.utc).date()
    out: list[CalendarEvent] = []
    for ev in CALENDAR:
        if "T" not in ev.when_et:
            out.append(ev)
            continue
        try:
            d = date.fromisoformat(ev.when_et[:10])
        except ValueError:
            out.append(ev)
            continue
        if d >= today:
            out.append(ev)
    return out

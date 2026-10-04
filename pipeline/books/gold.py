from pipeline.config import Book, RailsConfig, Series
from pipeline.models import Side

# Side maps are YOUR rules, stored as data. Edit them.
# EIA crude: inventory print above consensus is typically bearish WTI.
# CFTC gold managed-money net: treated as a positioning extreme, not a auto-fire
# unless you set a side. Default is None so COT never arms until you say so.
# GLD tonnes: holdings rise vs last snapshot = flow into the metal.

GOLD_BOOK = Book(
    id="gold",
    name="Gold / energy event book",
    rails=RailsConfig(
        max_notional_usd=10_000.0,
        max_daily_loss_usd=400.0,
        max_open_positions=1,
        require_two_sources=True,
        require_consensus=True,
        min_abs_surprise_pct=0.6,
        paper_only=True,
    ),
    series=[
        Series(
            id="eia_crude_stocks",
            name="EIA weekly crude stocks",
            instrument="CL",
            unit="mmbbl",
            urls=[
                "https://www.eia.gov/petroleum/supply/weekly/",
                "https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
            ],
            monitor_goal=(
                "Extract the latest U.S. commercial crude oil inventory "
                "figure in million barrels. Ignore products and Cushing "
                "unless labeled. Return the headline crude stocks print only."
            ),
            schedule="every wednesday at 10:35 America/New_York",
            side_if_print_above=Side.SHORT,
            qty=1.0,
            min_abs_surprise_pct=0.8,
            event_class="eia_crude",
        ),
        Series(
            id="gld_holdings",
            name="SPDR GLD tonnes",
            instrument="GC",
            unit="tonnes",
            urls=[
                "https://www.spdrgoldshares.com/usa/",
                "https://www.spdrgoldshares.com/usa/gold-bar-list/",
            ],
            monitor_goal=(
                "Extract current GLD gold holdings in tonnes. Prefer the "
                "official holdings figure, not the NAV or share count."
            ),
            schedule="every 6 hours",
            side_if_print_above=Side.LONG,
            qty=1.0,
            min_abs_surprise_pct=0.15,
            event_class="gld_flow",
        ),
        Series(
            id="cftc_gold_mm_net",
            name="CFTC gold managed money net",
            instrument="GC",
            unit="contracts",
            urls=[
                "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
                "https://www.cftc.gov/dea/futures/deacmesf.htm",
            ],
            monitor_goal=(
                "Extract managed-money net position in COMEX gold futures "
                "in contracts from the latest COT. Do not invent a number."
            ),
            schedule="every friday at 15:30 America/New_York",
            side_if_print_above=None,  # you fill this when you want COT to arm
            qty=1.0,
            min_abs_surprise_pct=8.0,
            event_class="cot_gold",
        ),
    ],
)

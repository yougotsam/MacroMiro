from pipeline.config import Book, RailsConfig, Series
from pipeline.models import Side

BTC_BOOK = Book(
    id="btc",
    name="Bitcoin ETF / unlock book",
    rails=RailsConfig(
        max_notional_usd=5_000.0,
        max_daily_loss_usd=250.0,
        max_open_positions=1,
        require_two_sources=True,
        require_consensus=True,
        min_abs_surprise_pct=1.0,
        paper_only=True,
    ),
    series=[
        Series(
            id="us_spot_btc_etf_flow",
            name="US spot BTC ETF daily net flow",
            instrument="BTCUSD",
            unit="usd_mn",
            urls=[
                "https://farside.co.uk/btc/",
                "https://www.theblock.co/data/crypto-markets/bitcoin-etf",
            ],
            monitor_goal=(
                "Extract the latest daily net flow for US spot bitcoin ETFs "
                "in million USD. Prefer the official table total, not a "
                "single issuer unless the page only shows one."
            ),
            schedule="every weekday at 18:00 America/New_York",
            side_if_print_above=Side.LONG,
            qty=0.05,
            min_abs_surprise_pct=20.0,
            event_class="btc_etf_flow",
        ),
    ],
)

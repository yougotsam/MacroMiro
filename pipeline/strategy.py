from __future__ import annotations

from pipeline.config import Book, Series
from pipeline.models import Decision, Print, Surprise, Verdict


class SurpriseMapStrategy:
    """Arms only when surprise clears the series threshold and a side map exists.

    The model never chooses the instrument or the side. The book does.
    """

    def decide(
        self,
        book: Book,
        series: Series,
        prints: list[Print],
        surprise: Surprise,
    ) -> Decision:
        sources = [p.source_url for p in prints]
        floor = series.min_abs_surprise_pct
        if floor is None:
            floor = book.rails.min_abs_surprise_pct

        if abs(surprise.pct) < floor:
            return Decision(
                verdict=Verdict.BLOCK,
                reason=f"surprise {surprise.pct:.3f}% below {floor}%",
                surprise=surprise,
                sources=sources,
            )

        if series.side_if_print_above is None:
            return Decision(
                verdict=Verdict.BLOCK,
                reason="no side map on this series — set side_if_print_above",
                surprise=surprise,
                sources=sources,
            )

        side = series.side_if_print_above if surprise.print_above else _flip(
            series.side_if_print_above
        )
        return Decision(
            verdict=Verdict.ARM,
            reason=f"surprise {surprise.pct:+.3f}% vs consensus {surprise.consensus}",
            side=side,
            qty=series.qty,
            surprise=surprise,
            sources=sources,
        )


def _flip(side):
    from pipeline.models import Side

    return Side.SHORT if side is Side.LONG else Side.LONG

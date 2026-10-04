from pipeline.books.btc import BTC_BOOK
from pipeline.books.gold import GOLD_BOOK
from pipeline.config import Book

BOOKS: dict[str, Book] = {
    GOLD_BOOK.id: GOLD_BOOK,
    BTC_BOOK.id: BTC_BOOK,
}


def load_book(book_id: str) -> Book:
    key = book_id.strip().lower()
    if key not in BOOKS:
        raise KeyError(f"unknown book {book_id!r}. known: {sorted(BOOKS)}")
    return BOOKS[key]

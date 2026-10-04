import { BOOK_LABEL, type BookScan } from "@/lib/envelope/board";
import type { BookId } from "@/lib/live/types";
import { cn } from "@/lib/utils";

function px(book: BookId, n: number) {
  if (book === "btc" || book === "es") return n.toFixed(0);
  if (book === "gold" || book === "silver") return n.toFixed(1);
  return n.toFixed(2);
}

export function ScanBoard({
  board,
  book,
  onBook,
}: {
  board: BookScan[];
  book: BookId;
  onBook: (id: BookId) => void;
}) {
  if (!board.length) {
    return <p className="text-sm text-muted">HEART has not ticked. Tick now.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {board.map((r) => (
        <li key={r.book}>
          <button
            type="button"
            onClick={() => onBook(r.book)}
            className={cn(
              "flex min-h-11 w-full items-baseline gap-2 py-2 text-left font-mono text-xs tabular-nums",
              book === r.book ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            <span className={cn("w-8", r.open ? "text-armed" : "text-subtle")}>{BOOK_LABEL[r.book]}</span>
            <span className="w-16">{r.last ? px(r.book, r.last) : "—"}</span>
            <span className="w-10 text-subtle">{r.regime === "trend" ? "T" : r.regime === "range" ? "R" : "M"}</span>
            <span className={r.stacked === "chop" ? "text-subtle" : r.stacked === "long" ? "text-armed" : "text-down"}>
              {r.side ?? r.stacked}
            </span>
            <span className="text-subtle">{r.rsi == null ? "—" : r.rsi.toFixed(0)}</span>
            <span className={r.auto ? "text-armed" : "text-subtle"}>{r.auto ? "LIVE" : r.action}</span>
            <span className="ml-auto truncate text-subtle">{r.reason}</span>
            <span className="text-subtle" title="Binary contract. Pays $1 if right. Not account leverage.">bin</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

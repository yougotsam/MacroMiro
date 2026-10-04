import { createFileRoute } from "@tanstack/react-router";
import { walkDesk } from "@/lib/envelope/backtest";
import { DEFAULT_TAPE } from "@/lib/live/indicators";
import { loadTape } from "@/lib/live/server";
import { loadScan } from "@/lib/scan/server";
import type { BookId } from "@/lib/live/types";

const BOOKS: BookId[] = ["btc", "sol", "eth", "gold", "silver", "es", "oil"];

export const Route = createFileRoute("/api/live/backtest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const bookRaw = url.searchParams.get("book") ?? "btc";
        const tf = url.searchParams.get("tf") ?? "15m";
        const book = BOOKS.includes(bookRaw as BookId) ? (bookRaw as BookId) : "btc";
        try {
          const tape = await loadTape(book, tf);
          let polyLive = null;
          try {
            const scan = await loadScan();
            polyLive = scan.fair;
          } catch {
            polyLive = null;
          }
          return Response.json(walkDesk(tape, DEFAULT_TAPE, polyLive));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "backtest failed" }, { status: 502 });
        }
      },
    },
  },
});

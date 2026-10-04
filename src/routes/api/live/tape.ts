import { createFileRoute } from "@tanstack/react-router";
import { loadTape } from "@/lib/live/server";
import type { BookId } from "@/lib/live/types";

const BOOKS: BookId[] = ["btc", "sol", "eth", "gold", "silver", "es", "oil"];

export const Route = createFileRoute("/api/live/tape")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const bookRaw = url.searchParams.get("book") ?? "btc";
        const tf = url.searchParams.get("tf") ?? "15m";
        const book = BOOKS.includes(bookRaw as BookId) ? (bookRaw as BookId) : "btc";
        try {
          return Response.json(await loadTape(book, tf));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "tape failed" }, { status: 502 });
        }
      },
    },
  },
});

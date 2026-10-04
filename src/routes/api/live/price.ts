import { createFileRoute } from "@tanstack/react-router";
import { loadSpot } from "@/lib/live/server";
import type { BookId } from "@/lib/live/types";

const BOOKS: BookId[] = ["btc", "eth", "sol", "gold"];

export const Route = createFileRoute("/api/live/price")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const bookRaw = url.searchParams.get("book") ?? "btc";
        const tf = url.searchParams.get("tf") ?? "15m";
        const book = BOOKS.includes(bookRaw as BookId) ? (bookRaw as BookId) : "btc";
        try {
          return Response.json(await loadSpot(book, tf));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "price failed" }, { status: 502 });
        }
      },
    },
  },
});

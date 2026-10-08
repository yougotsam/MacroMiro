import { createFileRoute } from "@tanstack/react-router";
import { switchState } from "@/lib/desk/risk";
import { readDeskStatus } from "@/lib/desk/view";

/** Read-only. Orders are placed only by the desk engine process through src/lib/desk/oms.ts. */
export const Route = createFileRoute("/api/live/kalshi-order")({
  server: {
    handlers: {
      GET: async () => {
        const sw = switchState();
        const desk = readDeskStatus();
        return Response.json({
          path: "desk engine → risk gate → POST /trade-api/v2/portfolio/events/orders (exchange_index 2)",
          ok: sw.live && sw.begin && sw.arm && Boolean(desk),
          switches: sw,
          engine: desk ? { ts: desk.ts, model: desk.model, latched: desk.latched, snapshot: desk.snapshot } : null,
          note: "GET never places orders. The web app has no order path.",
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { liveReadyNow } from "@/lib/scan/kalshi-order";

export const Route = createFileRoute("/api/live/kalshi-order")({
  server: {
    handlers: {
      GET: async () => {
        const ready = await liveReadyNow();
        return Response.json({
          path: "POST /trade-api/v2/portfolio/events/orders",
          ...ready,
          armed: ready.ok,
          note: "P0: live execution disabled. GET never places orders.",
        });
      },
    },
  },
});

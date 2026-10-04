import { createFileRoute } from "@tanstack/react-router";
import { liveExecutionAllowed } from "@/lib/envelope/kill.server";
import { ensurePyth, pythStatus } from "@/lib/skill/pyth-socket.server";

export const Route = createFileRoute("/api/live/pyth")({
  server: {
    handlers: {
      GET: async () => {
        const before = pythStatus();
        const status = before.status === "disconnected" && !before.seenLive ? ensurePyth() : pythStatus();
        return Response.json({ ...status, orders: 0, liveExecution: liveExecutionAllowed() });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { beginFlagOn, liveExecutionAllowed, liveFlagOn } from "@/lib/envelope/kill.server";
import { brtiStatus, ensureBrti } from "@/lib/skill/brti-socket.server";

export const Route = createFileRoute("/api/live/brti")({
  server: {
    handlers: {
      GET: async () => {
        const before = brtiStatus();
        const status = before.healthy ? before : ensureBrti();
        return Response.json({
          ...status,
          orders: 0,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
        });
      },
    },
  },
});

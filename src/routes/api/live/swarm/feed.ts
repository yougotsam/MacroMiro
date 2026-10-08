import { createFileRoute } from "@tanstack/react-router";
import { resumeMirofish, swarmFeed } from "@/lib/intel/mirofish";

/** Read-only. What the swarm agents are doing now, for the swarm panel. Poll every few seconds. */
export const Route = createFileRoute("/api/live/swarm/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        resumeMirofish();
        const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
        return Response.json({ ok: true, ...(await swarmFeed(limit)) });
      },
    },
  },
});

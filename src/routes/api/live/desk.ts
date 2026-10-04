import { createFileRoute } from "@tanstack/react-router";
import { bustDeskCache, loadDesk } from "@/lib/live/server";

export const Route = createFileRoute("/api/live/desk")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const fresh = new URL(request.url).searchParams.get("fresh") === "1";
          if (fresh) bustDeskCache();
          const data = await loadDesk(fresh);
          return Response.json(data);
        } catch (err) {
          const message = err instanceof Error ? err.message : "desk failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  },
});

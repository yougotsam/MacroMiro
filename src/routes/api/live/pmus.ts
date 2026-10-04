import { createFileRoute } from "@tanstack/react-router";
import { loadPmus } from "@/lib/scan/pmus.server";

export const Route = createFileRoute("/api/live/pmus")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const fresh = url.searchParams.get("fresh") === "1";
        return Response.json(await loadPmus(fresh));
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { bustScanCache, loadScan } from "@/lib/scan/server";

export const Route = createFileRoute("/api/live/scan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const fresh = new URL(request.url).searchParams.get("fresh") === "1";
        if (fresh) bustScanCache();
        try {
          return Response.json(await loadScan(fresh));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "scan failed" }, { status: 502 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { knockMirofish, miroSnapshot, probeMirofish, resumeMirofish } from "@/lib/intel/mirofish";

export const Route = createFileRoute("/api/live/swarm")({
  server: {
    handlers: {
      GET: async () => {
        resumeMirofish();
        const probe = await probeMirofish();
        return Response.json({
          ok: true,
          sendsOrders: false,
          town: probe,
          snap: miroSnapshot(),
          note: "MiroFish is a separate process. A missing probability is not a trade. The desk never waits on it.",
        });
      },
      /** Knock once. Returns at once; the walk runs in the background. Body {force:true} reruns a finished headline (spends money). */
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { force?: boolean };
        const town = await probeMirofish();
        if (!town.up) {
          return Response.json({ ok: false, sendsOrders: false, started: false, reason: `town down: ${town.detail}`, town, snap: miroSnapshot() });
        }
        const out = knockMirofish({ force: body.force === true });
        return Response.json({ ok: true, sendsOrders: false, ...out, town });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { miroSnapshot, probeMirofish, syncMirofish } from "@/lib/intel/mirofish";

export const Route = createFileRoute("/api/live/swarm")({
  server: {
    handlers: {
      GET: async () => {
        const [probe, snap] = await Promise.all([probeMirofish(), Promise.resolve(miroSnapshot())]);
        return Response.json({
          ok: true,
          sendsOrders: false,
          town: probe,
          snap,
          note: "MiroFish is a separate process. A missing probability is not a trade.",
        });
      },
      POST: async () => {
        const row = await syncMirofish();
        return Response.json({ ok: true, sendsOrders: false, row, snap: miroSnapshot(), town: await probeMirofish() });
      },
    },
  },
});

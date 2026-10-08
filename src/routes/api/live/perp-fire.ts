import { createFileRoute } from "@tanstack/react-router";

/** Perps are off. This route used to place perp orders; it now refuses everything. */
const gone = () => Response.json({ error: "perp orders disabled" }, { status: 410 });

export const Route = createFileRoute("/api/live/perp-fire")({
  server: { handlers: { GET: async () => gone(), POST: async () => gone() } },
});

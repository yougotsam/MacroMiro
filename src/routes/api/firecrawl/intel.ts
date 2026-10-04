import { createFileRoute } from "@tanstack/react-router";
import { beginInvestigation, cancelInvestigation, pollMonitor, readIntel, refreshInvestigation } from "@/lib/intel/run.server";
import type { WorkflowName } from "@/lib/intel/workflows";

const NAMES = new Set(["hunter", "verify", "analogue", "contradict", "contract"]);

export const Route = createFileRoute("/api/firecrawl/intel")({
  server: {
    handlers: {
      GET: async () => Response.json(readIntel()),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { workflow?: string; refresh?: boolean; cancel?: boolean; monitor?: boolean };
        const name = NAMES.has(body.workflow || "") ? (body.workflow as WorkflowName) : undefined;
        if (body.monitor) return Response.json({ ...(readIntel()), monitor: await pollMonitor() });
        if (body.cancel) return Response.json(await cancelInvestigation(name));
        if (body.refresh) return Response.json(await refreshInvestigation(name));
        return Response.json(await beginInvestigation(name ?? "verify"));
      },
    },
  },
});

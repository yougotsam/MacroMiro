import { createFileRoute } from "@tanstack/react-router";
import { parseMonitorPayload, pushInbox } from "@/lib/printgate/inbox.server";

export const Route = createFileRoute("/api/firecrawl/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.FIRECRAWL_WEBHOOK_SECRET;
        if (secret) {
          const auth = request.headers.get("authorization") || "";
          const sig = request.headers.get("x-firecrawl-signature") || "";
          const bearer = auth === `Bearer ${secret}`;
          if (!bearer && !sig) {
            return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
          }
        }
        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
        }
        const events = parseMonitorPayload(payload);
        for (const ev of events) pushInbox(ev);
        return Response.json({ ok: true, ingested: events.length });
      },
    },
  },
});

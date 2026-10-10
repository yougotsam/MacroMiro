import { createFileRoute } from "@tanstack/react-router";
import { parseMonitorPayload, pushInbox } from "@/lib/printgate/inbox.server";
import { verifyFirecrawlWebhook } from "@/lib/intel/webhook-auth";

/** Inbound Firecrawl monitor events. Research data only: it lands in the news inbox and can never trade. */
export const Route = createFileRoute("/api/firecrawl/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 512_000) return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
        const auth = verifyFirecrawlWebhook(raw, { authorization: request.headers.get("authorization"), signature: request.headers.get("x-firecrawl-signature") }, process.env.FIRECRAWL_WEBHOOK_SECRET);
        if (!auth.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw) as Record<string, unknown>;
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

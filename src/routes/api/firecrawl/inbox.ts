import { createFileRoute } from "@tanstack/react-router";
import { listInbox } from "@/lib/printgate/inbox.server";

export const Route = createFileRoute("/api/firecrawl/inbox")({
  server: {
    handlers: {
      GET: async () => Response.json({ events: listInbox() }),
    },
  },
});

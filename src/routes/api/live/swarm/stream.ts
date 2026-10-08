import { createFileRoute } from "@tanstack/react-router";
import { resumeMirofish, swarmFeed } from "@/lib/intel/mirofish";

/**
 * Read-only server-sent events. Relays the swarm feed every 3s for up to 10 minutes, then closes.
 * MiroFish has no push stream of its own; this polls it and forwards only what changed.
 */
export const Route = createFileRoute("/api/live/swarm/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        resumeMirofish();
        const enc = new TextEncoder();
        let closed = false;
        request.signal?.addEventListener("abort", () => {
          closed = true;
        });
        const stream = new ReadableStream({
          async start(controller) {
            let last = "";
            const end = Date.now() + 10 * 60_000;
            while (!closed && Date.now() < end) {
              try {
                const feed = await swarmFeed(30);
                const body = JSON.stringify(feed);
                if (body !== last) {
                  controller.enqueue(enc.encode(`event: swarm\ndata: ${body}\n\n`));
                  last = body;
                } else {
                  controller.enqueue(enc.encode(`: ping\n\n`));
                }
                if (!feed.snap.running && feed.snap.stage !== "idle") {
                  controller.enqueue(enc.encode(`event: end\ndata: ${JSON.stringify({ stage: feed.snap.stage })}\n\n`));
                  break;
                }
              } catch {
                closed = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 3000));
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          },
          cancel() {
            closed = true;
          },
        });
        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
        });
      },
    },
  },
});

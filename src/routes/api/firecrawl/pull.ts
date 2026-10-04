import { readFileSync } from "node:fs";
import { createFileRoute } from "@tanstack/react-router";
import { firecrawlReady, pullOfficial } from "@/lib/live/firecrawl.server";

const KEY_FILES = ["/workspace/.grok/secrets/fc", "/tmp/fc.key"];

function hydrateKey() {
  if ((process.env.FIRECRAWL_API_KEY ?? "").startsWith("fc-")) return;
  for (const path of KEY_FILES) {
    try {
      const disk = readFileSync(path, "utf8").trim();
      if (disk.startsWith("fc-")) {
        process.env.FIRECRAWL_API_KEY = disk;
        return;
      }
    } catch {
      /* next */
    }
  }
}

export const Route = createFileRoute("/api/firecrawl/pull")({
  server: {
    handlers: {
      GET: async () => {
        hydrateKey();
        return Response.json({ live: firecrawlReady() });
      },
      POST: async () => {
        hydrateKey();
        const result = await pullOfficial();
        return Response.json(result);
      },
    },
  },
});

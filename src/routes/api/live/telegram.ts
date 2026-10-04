import { createFileRoute } from "@tanstack/react-router";
import { loadScan } from "@/lib/scan/server";
import { pingScan, telegramReady } from "@/lib/scan/telegram";

export const Route = createFileRoute("/api/live/telegram")({
  server: {
    handlers: {
      GET: async () => Response.json({ ready: telegramReady(), auto: "off" }),
      POST: async () => {
        if (!telegramReady()) return Response.json({ ok: false, error: "no telegram secret" }, { status: 400 });
        const data = await loadScan(true);
        const ping = await pingScan(data, true);
        return Response.json({
          ok: ping.sent,
          reason: ping.reason,
          scanN: data.scanN,
          text: ping.sent,
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { PERP_LEV_CAP, PERP_LEV_DEFAULT, readSlider, writeSlider } from "@/lib/scan/perp-slider";

export const Route = createFileRoute("/api/live/leverage")({
  server: {
    handlers: {
      GET: async () => Response.json({ slider: readSlider(), caps: PERP_LEV_CAP, defaults: PERP_LEV_DEFAULT }),
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { ticker?: string; leverage?: number } | null;
        const ticker = String(body?.ticker ?? "");
        const leverage = Number(body?.leverage);
        if (!ticker.endsWith("PERP") || !(leverage >= 1) || leverage > 20) {
          return Response.json({ error: "bad slider" }, { status: 400 });
        }
        writeSlider(ticker, Math.round(leverage * 10) / 10);
        return Response.json({ ok: true, slider: readSlider() });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { switchState } from "@/lib/desk/risk";
import { liveMarginTransport } from "@/lib/perps/live-transport";
import { PerpsOms } from "@/lib/perps/oms";
import { dataDir } from "@/lib/desk/config";

const CAP = 3;

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      GET: async () => Response.json({ book: "perp", locked: false, capUsd: CAP, switches: switchState() }),
      POST: async ({ request }) => {
        const sw = switchState();
        if (!sw.live || !sw.begin || !sw.arm) return Response.json({ ok: false, why: "desk switches are off" }, { status: 409 });
        const body = (await request.json().catch(() => ({}))) as { ticker?: string; side?: "bid" | "ask"; price?: number; clipUsd?: number };
        const ticker = String(body.ticker ?? "");
        const price = Number(body.price);
        const clip = Number(body.clipUsd ?? price);
        if (!/^KX[A-Z0-9]+PERP$/.test(ticker)) return Response.json({ ok: false, why: "perp ticker" }, { status: 400 });
        if (!(price > 0) || !(clip > 0)) return Response.json({ ok: false, why: "price" }, { status: 400 });
        if (clip > CAP || price > CAP) return Response.json({ ok: false, why: `one contract is above the $${CAP} cap` }, { status: 400 });
        const oms = new PerpsOms(liveMarginTransport, `${dataDir()}/perps-journal.jsonl`, true);
        const sent = await oms.submit({
          kind: "entry",
          ticker,
          dir: body.side === "ask" ? "short" : "long",
          qty: 1,
          price,
          maker: true,
          decisionId: `perp-${ticker}-${Date.now()}`,
        });
        return Response.json({ ok: sent.status === "ACK", ...sent });
      },
    },
  },
});

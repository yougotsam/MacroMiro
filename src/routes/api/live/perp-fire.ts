import { createFileRoute } from "@tanstack/react-router";
import { switchState } from "@/lib/desk/risk";
import { liveMarginTransport } from "@/lib/perps/live-transport";
import { PerpsOms } from "@/lib/perps/oms";
import { dataDir } from "@/lib/desk/config";
import { mayFire, pressPlan } from "@/lib/perps/flip-plan";

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      GET: async () => Response.json({ book: "perp", locked: false, switches: switchState() }),
      POST: async ({ request }) => {
        const sw = switchState();
        const body = (await request.json().catch(() => ({}))) as {
          ticker?: string; side?: "bid" | "ask"; price?: number; clipUsd?: number; leverage?: number; tpMultiple?: number; slPercent?: number;
          sweep?: "low" | "high" | null; gap?: "yes" | "no" | null; funding?: number | null; spread?: number | null;
          balanceUsd?: number; downUsd?: number; lossesInARow?: number; clicked?: boolean;
        };
        const ticker = String(body.ticker ?? "");
        const price = Number(body.price);
        const side = body.side === "ask" ? "ask" : "bid";
        const lev = Number(body.leverage);
        const clip = Number(body.clipUsd);
        const sl = Number(body.slPercent);
        const tp = Number(body.tpMultiple);
        if (!/^KX[A-Z0-9]+PERP$/.test(ticker)) return Response.json({ ok: false, why: "perp ticker" }, { status: 400 });
        if (!(price > 0)) return Response.json({ ok: false, why: "price" }, { status: 400 });
        if (!(lev >= 2)) return Response.json({ ok: false, why: "perpetual leverage unread" }, { status: 400 });
        if (!(clip > 0) || !(sl > 0) || !(tp > 0)) return Response.json({ ok: false, why: "clip, stop, or target missing" }, { status: 400 });
        const gate = mayFire({
          ticker,
          side: side === "ask" ? "short" : "long",
          sweep: body.sweep ?? null,
          gap: body.gap ?? null,
          funding: body.funding ?? null,
          spread: body.spread ?? null,
          pileUsd: Number(body.balanceUsd),
          clipUsd: clip,
          stopLossPctOfClip: sl,
          downUsd: Number(body.downUsd ?? 0),
          lossesInARow: Number(body.lossesInARow ?? 0),
          clicked: body.clicked === true,
        });
        if (!gate.ok) return Response.json({ ok: false, why: gate.why }, { status: 409 });
        const margin = price / lev;
        const qty = Math.floor(clip / margin);
        if (qty < 1) return Response.json({ ok: false, why: `one contract posts $${margin.toFixed(2)}, more than the $${clip.toFixed(2)} clip` }, { status: 400 });
        const loss = clip * (sl / 100);
        const plan = pressPlan(price, side === "ask" ? "short" : "long", qty, loss, tp);
        if (!plan) return Response.json({ ok: false, why: "the stop would go through zero" }, { status: 400 });
        const prices = `Stop ${plan.stop.toFixed(4)}. Half ${plan.t1.toFixed(4)}. Rest ${plan.t2.toFixed(4)}.`;
        if (!sw.live || !sw.begin || !sw.arm) {
          return Response.json({ ok: false, why: `Plan is set. ${prices} The three switches are off, so Kalshi did not get it.` }, { status: 409 });
        }
        const oms = new PerpsOms(liveMarginTransport, `${dataDir()}/perps-journal.jsonl`, true, () => ({ ok: true, why: "desk switches already checked" }));
        const sent = await oms.submit({
          kind: "entry",
          ticker,
          dir: plan.dir,
          qty,
          price,
          maker: true,
          plan,
          decisionId: `perp-${ticker}-${Date.now()}`,
        });
        return Response.json({ ok: sent.status === "ACK", ...sent, leverage: lev, qty, margin });
      },
    },
  },
});

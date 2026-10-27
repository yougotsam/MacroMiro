import { createFileRoute } from "@tanstack/react-router";
import { switchState } from "@/lib/desk/risk";
import { liveMarginTransport } from "@/lib/perps/live-transport";
import { PerpsOms } from "@/lib/perps/oms";
import type { ManagePlan } from "@/lib/perps/manage";
import { dataDir } from "@/lib/desk/config";
import { mayFire } from "@/lib/perps/flip-plan";

function bracket(price: number, side: "bid" | "ask", lev: number, slPercent: number, tpMultiple: number, qty: number): ManagePlan {
  const risk = slPercent / 100 / lev;
  const reward = risk * tpMultiple;
  const dir = side === "ask" ? "short" : "long";
  const stop = dir === "long" ? price * (1 - risk) : price * (1 + risk);
  const take = dir === "long" ? price * (1 + reward) : price * (1 - reward);
  return { dir, qty, entry: price, stop, t1: (price + take) / 2, t2: take, partialFrac: 0.5, trailR: 1, maxHoldMs: 8 * 3_600_000 };
}

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      GET: async () => Response.json({ book: "perp", locked: false, switches: switchState() }),
      POST: async ({ request }) => {
        const sw = switchState();
        if (!sw.live || !sw.begin || !sw.arm) {
          return Response.json({ ok: false, why: "The three desk switches are off, so the click was not sent to Kalshi." }, { status: 409 });
        }
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
        const oms = new PerpsOms(liveMarginTransport, `${dataDir()}/perps-journal.jsonl`, true, () => ({ ok: true, why: "desk switches already checked" }));
        const sent = await oms.submit({
          kind: "entry",
          ticker,
          dir: side === "ask" ? "short" : "long",
          qty,
          price,
          maker: true,
          plan: bracket(price, side, lev, sl, tp, qty),
          decisionId: `perp-${ticker}-${Date.now()}`,
        });
        return Response.json({ ok: sent.status === "ACK", ...sent, leverage: lev, qty, margin });
      },
    },
  },
});

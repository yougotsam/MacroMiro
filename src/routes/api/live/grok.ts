import { createFileRoute } from "@tanstack/react-router";
import { heartStatus } from "@/lib/envelope/heart.server";
import { CLIP_USD, LEV, MAX_SLOTS, STREAK_SIT } from "@/lib/envelope/clip";
import { coldStreak } from "@/lib/envelope/pulse";

export const Route = createFileRoute("/api/live/grok")({
  server: {
    handlers: {
      GET: async () => {
        const h = heartStatus();
        return Response.json({
          role: "risk",
          instruction:
            "Read-only. Scan KXBTC15M, KXETH15M, KXSOL15M, KXXRP15M, KXGOLD15M. Bitcoin, ether, solana, and XRP settle on their CF Benchmarks 60-second index. Gold settles on the Pyth 1-minute close. Rule is docs/STRATEGY.md. Do not invent orders.",
          armed: h.armed,
          cash: h.cash,
          clipUsd: h.clipUsd ?? CLIP_USD,
          lev: LEV,
          slots: MAX_SLOTS,
          streakSit: STREAK_SIT,
          cold: coldStreak(h.ledger),
          round: h.round ?? null,
          positions: h.positions,
          board: h.board,
          lastNote: h.lastNote,
          lastFill: h.lastFill,
          lastTick: h.lastTick,
        });
      },
    },
  },
});
